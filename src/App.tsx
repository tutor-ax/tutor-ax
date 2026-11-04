import { useEffect, useRef, useState, type FormEvent } from "react";
import { InvalidCredentials, type LoginData, type ScoreGateway } from "./gateway";
import Scores from "./Scores";
import academyLogo from "./assets/academy-logo.svg";
import Admin from "./admin/Admin";
import Vocab from "./vocab/Vocab";
import Passage from "./passage/Passage";

import { currentRoute, navigationUrl } from "./routing";
function locationRoute() {
  return currentRoute(new URL(location.href));
}
export default function App({ gateway }: { gateway: ScoreGateway }) {
  const [data, setData] = useState<LoginData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [route, setRoute] = useState(locationRoute);
  const pinInput = useRef<HTMLInputElement>(null);
  // Only the admin/student split matters for session lookup; switching between
  // student tabs must not refetch, so the effect depends on this flag and not
  // on the full route.
  const isAdminRoute = route === "admin";
  useEffect(() => {
    // The administrator shell is independent of the student session: looking
    // one up here would leak a student lookup into an unrelated workspace.
    if (isAdminRoute) {
      setBusy(false);
      return;
    }
    let alive = true;
    gateway
      .resume()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(() => {
        if (alive)
          setError("세션을 확인하지 못했습니다. 다시 로그인해주세요.");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [gateway, isAdminRoute]);
  useEffect(() => {
    const changed = () => setRoute(locationRoute());
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("popstate", changed);
      window.removeEventListener("hashchange", changed);
    };
  }, []);
  function navigate(path: string) {
    history.pushState({}, "", navigationUrl(path));
    window.dispatchEvent(new PopStateEvent("popstate"));
    setRoute(locationRoute());
  }
  async function logout() {
    setData(null);
    setName("");
    setPin("");
    setError("");
    setBusy(true);
    try {
      await gateway.logout();
    } catch {
      // The local session is already cleared; a failed server call only means
      // the cookie may outlive this tab, so say that rather than blocking.
      setError("로그아웃은 되었지만 서버 확인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
    navigate("/");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !pin.trim()) {
      setError("이름과 PIN을 모두 입력해주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      setData(await gateway.login(name.trim(), pin.trim()));
      setName("");
      setPin("");
    } catch (cause) {
      setError(
        cause instanceof InvalidCredentials
          ? "이름 또는 PIN이 올바르지 않습니다."
          : "로그인하지 못했습니다. 잠시 후 다시 시도해주세요.",
      );
      // Never keep a PIN around after a failed attempt.
      setPin("");
      pinInput.current?.focus();
    } finally {
      setBusy(false);
    }
  }
  const returnToScores = () => navigate("/scores");
  // Admin owns its shell. Never nest it inside the student layout.
  if (route === "admin") {
    return (
      <div style={{ width: "100%" }} data-testid="admin-workspace">
        <Admin onExit={returnToScores} />
      </div>
    );
  }
  return (
    <div className="student-shell">
      <a className="skip-link" href="#student-main">
        본문으로 건너뛰기
      </a>
      <header className="site-header">
        <img
          className="academy-logo"
          src={academyLogo}
          alt="학원 로고"
          width="40"
          height="40"
        />
        <div className="notebook-brand">
          영어과
        </div>
        <nav
          className={`tab-nav${data ? " show" : ""}`}
          id="tab-nav"
          aria-label="학습 메뉴"
        >
          <button
            className={`tab-btn${route === "scores" ? " active" : ""}`}
            aria-current={route === "scores" ? "page" : undefined}
            onClick={() => navigate("/scores")}
          >
            점수 확인
          </button>
          <button
            className={`tab-btn${route === "vocab" ? " active" : ""}`}
            aria-current={route === "vocab" ? "page" : undefined}
            onClick={() => navigate("/vocab/")}
          >
            단어 공부
          </button>
          <button
            className={`tab-btn${route === "passage" ? " active" : ""}`}
            aria-current={route === "passage" ? "page" : undefined}
            onClick={() => navigate("/vocab/?go=passage")}
          >
            지문 공부
          </button>
        </nav>
        {data && (
          <div className="student-info">
            <span className="student-name" id="result-name">
              {data.student.name}
            </span>
            {data.student.classes?.name && (
              <span className="student-class" id="result-class">
                {data.student.classes.name}
              </span>
            )}
          </div>
        )}
      </header>
      <main
        id="student-main"
        tabIndex={-1}
        className={`container ${data && route !== "scores" ? "study-container" : ""}`}
      >
        {!data ? (
          <section id="login-section">
            <div className="login-intro">
              <h1>나의 영어 노트</h1>
              <p className="intro-lead">
                점수를 살펴보고,
                <br />
                다음 공부를 이어가요.
              </p>
              <p>
                시험 결과와 학습 기록을 확인하세요.
                <br />
                성적 기록부터 단어와 지문 복습까지 한곳에 모았어요.
              </p>
              <ul className="notebook-contents">
                <li>
                  <strong>점수 확인</strong>
                  <span>주차별 결과와 클리닉 안내</span>
                </li>
                <li>
                  <strong>단어 공부</strong>
                  <span>직접 풀고, 틀린 단어 다시 보기</span>
                </li>
                <li>
                  <strong>지문 공부</strong>
                  <span>한 문장씩 읽고 해석 확인하기</span>
                </li>
              </ul>
            </div>
            <div className="login-entry">
              <div className="card">
                <div className="card-header">
                  <h2>학생 로그인</h2>
                </div>
                <div className="card-body">
                  <form onSubmit={submit}>
                    <div className="form-group">
                      <label htmlFor="input-name">학생 이름</label>
                      <input
                        id="input-name"
                        type="text"
                        placeholder="이름을 입력하세요"
                        autoComplete="off"
                        lang="ko"
                        inputMode="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            pinInput.current?.focus();
                          }
                        }}
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor="input-pin">학부모 연락처 뒷 4자리</label>
                      <input
                        id="input-pin"
                        ref={pinInput}
                        type="password"
                        placeholder="숫자 4자리"
                        maxLength={4}
                        autoComplete="off"
                        inputMode="numeric"
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                      />
                    </div>
                    <button
                      className="btn btn-primary"
                      type="submit"
                      disabled={busy}
                    >
                      점수 확인하기
                    </button>
                  </form>
                  <div
                    className={`error-msg${error ? " show" : ""}`}
                    id="error-msg"
                    role="alert"
                  >
                    {error}
                  </div>
                </div>
              </div>
              <div
                className={`loading${busy ? " show" : ""}`}
                id="login-loading"
                role="status"
              >
                {busy && (
                  <>
                    <div className="spinner" />
                    확인 중...
                  </>
                )}
              </div>
            </div>
          </section>
        ) : route === "vocab" ? (
          <section data-testid="vocab-workspace">
            <Vocab onExit={returnToScores} />
          </section>
        ) : route === "passage" ? (
          <section data-testid="passage-workspace">
            <Passage onExit={returnToScores} />
          </section>
        ) : (
          <Scores
            data={data}
            onLogout={logout}
            onStudy={(target) =>
              navigate(target === "vocab" ? "/vocab/" : "/vocab/?go=passage")
            }
          />
        )}
      </main>
      <footer>© 용산대성N학원 영어과</footer>
      {/*
        Scores run on the live academy database. Vocabulary, passages and the
        administrator workspace are still local synthetic demos, so the notice
        stays on those routes only — removing it everywhere would misrepresent
        unmigrated screens as real records.
      */}
      {route !== "scores" && (
        <aside className="demo-notice" data-testid="demo-notice">
          이 화면은 아직 이전 전입니다
          <br />
          합성 데이터 · 이 브라우저에만 기록 · 실제 성적과 무관
        </aside>
      )}
    </div>
  );
}

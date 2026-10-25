import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LoginData, ScoreGateway } from "./gateway";
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
  useEffect(() => {
    let alive = true;
    gateway
      .resume()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(() => {
        if (alive)
          setError("세션을 확인하지 못했습니다. 데모로 다시 들어가 주세요.");
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [gateway]);
  useEffect(() => {
    const changed = () => setRoute(locationRoute());
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  function navigate(path: string) {
    history.pushState({}, "", navigationUrl(path));
    window.dispatchEvent(new PopStateEvent("popstate"));
    setRoute(locationRoute());
  }
  async function openDemo() {
    setBusy(true);
    setError("");
    try {
      setData(await gateway.openDemo());
      setName("");
      setPin("");
    } catch {
      setError("데모 데이터를 불러오지 못했습니다. 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
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
      setError(
        "세션 삭제를 확인하지 못했습니다. 브라우저 저장소를 확인해주세요.",
      );
    } finally {
      setBusy(false);
    }
    navigate("/");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    setError(
      !name.trim() || !pin.trim()
        ? "이름과 PIN을 모두 입력해주세요."
        : "운영 로그인이 연결되지 않은 개발본입니다. 데모로 둘러보기를 이용해주세요.",
    );
    setPin("");
  }
  const returnToScores = () => navigate("/scores");
  return (
    <>
      <header className="site-header">
        <img
          className="academy-logo"
          src={academyLogo}
          alt="학원 로고"
          width="40"
          height="40"
        />
        <h1>
          영어과 <span>성적 관리</span>
        </h1>
        <nav
          className={`tab-nav${data ? " show" : ""}`}
          id="tab-nav"
          aria-label="학습 메뉴"
        >
          <button
            className={`tab-btn${route === "scores" ? " active" : ""}`}
            onClick={() => navigate("/scores")}
          >
            점수 확인
          </button>
          <button
            className={`tab-btn${route === "vocab" ? " active" : ""}`}
            onClick={() => navigate("/vocab/")}
          >
            단어 공부
          </button>
          <button
            className={`tab-btn${route === "passage" ? " active" : ""}`}
            onClick={() => navigate("/vocab/?go=passage")}
          >
            지문 공부
          </button>
        </nav>
      </header>
      <main
        className={`container ${route === "admin" ? "admin-container" : data && route !== "scores" ? "study-container" : ""}`}
      >
        {route === "admin" ? (
          <section data-testid="admin-workspace">
            <Admin onExit={returnToScores} />
          </section>
        ) : !data ? (
          <section id="login-section">
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
            <button
              className="btn btn-secondary"
              data-testid="demo-login"
              disabled={busy}
              onClick={openDemo}
            >
              데모로 둘러보기
            </button>
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
          <Scores data={data} onLogout={logout} />
        )}
      </main>
      <footer>© Tutor AX 데모 학원 영어과</footer>
      <aside className="demo-notice" data-testid="demo-notice">
        tutor-ax · React 마이그레이션 개발본
        <br />
        합성 테스트 데이터 전용 · 운영 로그인·DB·문자 발송 연결 없음
      </aside>
    </>
  );
}

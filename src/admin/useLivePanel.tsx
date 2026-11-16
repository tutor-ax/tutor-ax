import { useEffect, useState, type ReactNode } from "react";
import { AdminConflict, AdminInvalid, AdminLocked, AdminUnauthorized, createAdminApi, type AdminApi } from "../adminApi";

// 실제 DB 구역 공통: 관리자 로그인(쿠키 세션), 진행 중 표시, 오류 안내. onConflict·invalid 문구는 화면마다 다르다.
export function useLivePanel(
  fetchImpl: typeof fetch | undefined,
  opts: { onSignedIn: (api: AdminApi) => Promise<void>; onConflict?: () => Promise<void>; invalidMessage: string },
) {
  const [api] = useState(() => createAdminApi(fetchImpl));
  const [signedIn, setSignedIn] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<void>, done = "") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
      if (done) setNotice(done);
    } catch (e) {
      if (e instanceof AdminUnauthorized) {
        setSignedIn(false);
        setError("관리자 비밀번호가 맞지 않거나 로그인이 만료됐습니다.");
      } else if (e instanceof AdminLocked) setError("로그인 실패가 많아 10분간 잠겼습니다.");
      else if (e instanceof AdminConflict) {
        setError("다른 곳에서 먼저 수정됐습니다. 최신 내용으로 다시 불러왔으니 확인 후 다시 입력하세요.");
        await opts.onConflict?.().catch(() => {});
      } else if (e instanceof AdminInvalid) {
        setError(opts.invalidMessage);
        await opts.onConflict?.().catch(() => {});
      } else setError("서버에 저장하지 못했습니다. 잠시 후 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  };

  // 이미 로그인된 세션(쿠키)이 있으면 이어간다. 없으면(401) 조용히 로그인 화면.
  useEffect(() => {
    opts.onSignedIn(api).then(() => setSignedIn(true)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const login = (label: string): ReactNode => (
    <section aria-label={label}>
      <h3>실제 DB</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.login(password);
            setPassword("");
            await opts.onSignedIn(api);
            setSignedIn(true);
          });
        }}
      >
        <label>
          관리자 비밀번호
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button type="submit" disabled={busy || !password}>
          연결
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </section>
  );

  return { api, signedIn, busy, error, setError, notice, setNotice, run, login };
}

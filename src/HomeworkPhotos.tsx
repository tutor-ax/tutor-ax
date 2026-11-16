import { useState } from "react";
import { MAX_PHOTOS_PER_WEEK, PHOTO_TYPES, PhotoError, type HomeworkApi, type HomeworkPhoto } from "./photoApi";

export default function HomeworkPhotos({ weekId, api }: { weekId: number; api: HomeworkApi }) {
  const [photos, setPhotos] = useState<HomeworkPhoto[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const run = async (task: () => Promise<void>, done = "") => {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await task();
      setNotice(done);
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : "사진을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  };
  const load = () => run(async () => setPhotos(await api.list(weekId)));
  const upload = (file: File) =>
    run(async () => {
      await api.upload(weekId, file);
      setPhotos(await api.list(weekId));
    }, "사진을 올렸어요.");

  return (
    <section className="homework-photos" aria-label="과제 인증 사진">
      <h2>과제 인증 사진</h2>
      <p>과제한 쪽을 찍어 올려주세요. JPG·PNG·HEIC, 10MB 이하, 주차당 {MAX_PHOTOS_PER_WEEK}장까지.</p>
      <label>
        사진 올리기
        <input
          type="file"
          accept={PHOTO_TYPES.join(",")}
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </label>
      {photos === null ? (
        <button type="button" disabled={busy} onClick={() => void load()}>
          올린 사진 보기
        </button>
      ) : photos.length === 0 ? (
        <p>아직 올린 사진이 없어요.</p>
      ) : (
        <ul>
          {photos.map((p, i) => (
            <li key={p.url}>
              <a href={p.url} target="_blank" rel="noreferrer">
                <img src={p.url} alt={`올린 사진 ${i + 1}`} loading="lazy" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {busy && <p role="status">처리 중...</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

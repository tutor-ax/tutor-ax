import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { createApiGateway } from "./gateway";
import "./styles/theme.css";
import "./styles/score.css";
import "./styles/student.css";

// The session lives in the parent_session cookie set by the existing
// score screen, so the app holds no client-side session state of its own.
const gateway = createApiGateway();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App gateway={gateway} />
  </StrictMode>,
);

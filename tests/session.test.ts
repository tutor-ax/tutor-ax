import { beforeEach, expect, it, vi } from "vitest";
import { createDemoGateway, DEMO_SESSION_KEY } from "../src/gateway";

beforeEach(() => localStorage.clear());
it("resumes only an unexpired demo marker and never stores student credentials", async () => {
  const gateway = createDemoGateway(localStorage);
  expect(await gateway.resume()).toBeNull();
  const data = await gateway.openDemo();
  expect(data.student.name).toBe("데모 학생");
  expect((await gateway.resume())?.student.name).toBe("데모 학생");
  expect(localStorage.getItem(DEMO_SESSION_KEY)).not.toContain("데모 학생");
  await gateway.logout();
  expect(await gateway.resume()).toBeNull();
});
it("fails closed for expired, malformed and unavailable storage without network calls", async () => {
  const network = vi.spyOn(globalThis, "fetch");
  const gateway = createDemoGateway(localStorage);
  localStorage.setItem(DEMO_SESSION_KEY, "{");
  expect(await gateway.resume()).toBeNull();
  localStorage.setItem(
    DEMO_SESSION_KEY,
    JSON.stringify({ version: 1, expiresAt: 0 }),
  );
  expect(await gateway.resume()).toBeNull();
  const unavailable = {
    getItem: () => {
      throw Error("denied");
    },
    setItem: () => {
      throw Error("denied");
    },
    removeItem: () => {
      throw Error("denied");
    },
  };
  expect((await createDemoGateway(unavailable).openDemo()).student.name).toBe(
    "데모 학생",
  );
  expect(await createDemoGateway(unavailable).resume()).toBeNull();
  expect(network).not.toHaveBeenCalled();
  network.mockRestore();
});

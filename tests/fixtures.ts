import type { LoginData, ScoreGateway } from "../src/gateway";
import { InvalidCredentials } from "../src/gateway";
import fixture from "../src/data/demo-score.json";

/**
 * Synthetic data and in-memory gateways for tests.
 *
 * This fixture was the production demo until the app moved to the live
 * academy database. It is kept because every screen test depends on its
 * shape — dynamic item configs, retest passes, absences, missing homework —
 * which is tedious to reproduce by hand. It must never ship to users.
 */
export function fixtureData(): LoginData {
  return structuredClone(fixture) as LoginData;
}

/** A gateway with a live session already established. */
export function signedIn(data: LoginData = fixtureData()): ScoreGateway {
  return {
    resume: async () => data,
    login: async () => data,
    logout: async () => {},
  };
}

/** A gateway with no session; `login` succeeds for any input. */
export function signedOut(data: LoginData = fixtureData()): ScoreGateway {
  return {
    resume: async () => null,
    login: async () => data,
    logout: async () => {},
  };
}

/** A gateway that rejects the supplied credentials. */
export function rejectsCredentials(): ScoreGateway {
  return {
    resume: async () => null,
    login: async () => {
      throw new InvalidCredentials();
    },
    logout: async () => {},
  };
}

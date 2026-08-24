import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../store/sessionStore";

/**
 * Tests for the idle session-timeout store (#488).
 *
 * The store holds the user's configuration (persisted) and a runtime `locked`
 * flag (never persisted). Provider/hook behavior is covered separately; these
 * tests assert the store contract, which is pure and DOM-free.
 */

describe("Session timeout store (#488)", () => {
  beforeEach(() => {
    useSessionStore.setState({
      idleTimeoutEnabled: true,
      idleTimeoutMinutes: 15,
      locked: false,
    });
  });

  it("defaults to a 15-minute enabled idle timeout", () => {
    const s = useSessionStore.getState();
    expect(s.idleTimeoutEnabled).toBe(true);
    expect(s.idleTimeoutMinutes).toBe(15);
    expect(s.locked).toBe(false);
  });

  it("can disable the timeout and change duration", () => {
    const store = useSessionStore.getState();
    store.setIdleTimeoutEnabled(false);
    store.setIdleTimeoutMinutes(60);
    const s = useSessionStore.getState();
    expect(s.idleTimeoutEnabled).toBe(false);
    expect(s.idleTimeoutMinutes).toBe(60);
  });

  it("setLocked only flips the runtime flag, not the persisted config", () => {
    useSessionStore.getState().setLocked(true);
    expect(useSessionStore.getState().locked).toBe(true);
    useSessionStore.getState().setLocked(false);
    expect(useSessionStore.getState().locked).toBe(false);
    // Configuration remains intact across lock/unlock.
    expect(useSessionStore.getState().idleTimeoutEnabled).toBe(false);
    expect(useSessionStore.getState().idleTimeoutMinutes).toBe(60);
  });

  it("persisted slice omits the runtime `locked` flag", () => {
    const persisted = JSON.stringify({
      idleTimeoutEnabled: useSessionStore.getState().idleTimeoutEnabled,
      idleTimeoutMinutes: useSessionStore.getState().idleTimeoutMinutes,
    });
    expect(persisted).not.toContain("locked");
  });
});

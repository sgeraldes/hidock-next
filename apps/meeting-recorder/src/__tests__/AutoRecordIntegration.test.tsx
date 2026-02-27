import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSessionStore } from "../store/useSessionStore";

describe("AutoRecord integration", () => {
  beforeEach(() => {
    const store = useSessionStore.getState();
    act(() => {
      store.setMicActive(false);
    });
  });

  it("micActive defaults to false", () => {
    const { result } = renderHook(() =>
      useSessionStore((s) => s.micActive),
    );
    expect(result.current).toBe(false);
  });

  it("setMicActive(true) sets micActive to true", () => {
    const { result } = renderHook(() => useSessionStore((s) => s.micActive));

    act(() => {
      useSessionStore.getState().setMicActive(true);
    });

    expect(result.current).toBe(true);
  });

  it("setMicActive(false) sets micActive back to false", () => {
    const { result } = renderHook(() => useSessionStore((s) => s.micActive));

    act(() => {
      useSessionStore.getState().setMicActive(true);
    });
    expect(result.current).toBe(true);

    act(() => {
      useSessionStore.getState().setMicActive(false);
    });
    expect(result.current).toBe(false);
  });
});

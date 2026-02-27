import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useElapsedTime } from "../hooks/useElapsedTime";

describe("useElapsedTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 when not active", () => {
    const { result } = renderHook(() => useElapsedTime(false));
    expect(result.current).toBe(0);
  });

  it("starts counting from 0 when activated", () => {
    const { result } = renderHook(() => useElapsedTime(true));
    expect(result.current).toBe(0);
  });

  it("increments every second while active", () => {
    const { result } = renderHook(() => useElapsedTime(true));

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(result.current).toBe(3);
  });

  it("resets to 0 when isActive becomes false", () => {
    let isActive = true;
    const { result, rerender } = renderHook(() => useElapsedTime(isActive));

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(5);

    isActive = false;
    rerender();

    expect(result.current).toBe(0);
  });

  it("restarts from 0 when isActive toggles back to true", () => {
    let isActive = true;
    const { result, rerender } = renderHook(() => useElapsedTime(isActive));

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current).toBe(4);

    isActive = false;
    rerender();
    expect(result.current).toBe(0);

    isActive = true;
    rerender();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(2);
  });

  it("cleans up interval on unmount (no memory leak)", () => {
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useElapsedTime(true));

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("does not increment when not active", () => {
    const { result } = renderHook(() => useElapsedTime(false));

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current).toBe(0);
  });
});

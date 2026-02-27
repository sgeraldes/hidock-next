import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MiniControlBar } from "../components/MiniControlBar";

describe("MiniControlBar", () => {
  const defaultProps = {
    isRecording: true,
    elapsedTime: 125,
    sessionTitle: "Team Standup",
    sessions: [
      { id: "s1", title: "Team Standup", status: "active" as const },
      { id: "s2", title: "Design Review", status: "complete" as const },
    ],
    activeSessionId: "s1",
    onEndRecording: vi.fn(),
    onSwitchSession: vi.fn(),
    onOpenMainWindow: vi.fn(),
  };

  it("renders recording indicator when recording", () => {
    render(<MiniControlBar {...defaultProps} />);
    expect(screen.getByTestId("recording-indicator")).toBeInTheDocument();
  });

  it("displays formatted elapsed time", () => {
    render(<MiniControlBar {...defaultProps} />);
    expect(screen.getByText("2:05")).toBeInTheDocument();
  });

  it("shows session title", () => {
    render(<MiniControlBar {...defaultProps} />);
    const titleElements = screen.getAllByText("Team Standup");
    expect(titleElements.length).toBeGreaterThan(0);
  });

  it("calls onEndRecording when stop button clicked", () => {
    render(<MiniControlBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("stop-recording-btn"));
    expect(defaultProps.onEndRecording).toHaveBeenCalled();
  });

  it("calls onOpenMainWindow when expand button clicked", () => {
    render(<MiniControlBar {...defaultProps} />);
    fireEvent.click(screen.getByTestId("open-main-btn"));
    expect(defaultProps.onOpenMainWindow).toHaveBeenCalled();
  });

  it("does not show recording indicator when not recording", () => {
    render(<MiniControlBar {...defaultProps} isRecording={false} />);
    expect(screen.queryByTestId("recording-indicator")).not.toBeInTheDocument();
  });

  it("displays 0:00 for zero elapsed time", () => {
    render(<MiniControlBar {...defaultProps} elapsedTime={0} />);
    expect(screen.getByText("0:00")).toBeInTheDocument();
  });

  it("renders session switcher dropdown with all sessions", () => {
    render(<MiniControlBar {...defaultProps} />);
    const switcher = screen.getByTestId("session-switcher");
    expect(switcher).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Team Standup" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Design Review" })).toBeInTheDocument();
  });

  it("calls onSwitchSession when a session is selected", () => {
    const onSwitchSession = vi.fn();
    render(<MiniControlBar {...defaultProps} onSwitchSession={onSwitchSession} />);
    const switcher = screen.getByTestId("session-switcher");
    fireEvent.change(switcher, { target: { value: "s2" } });
    expect(onSwitchSession).toHaveBeenCalledWith("s2");
  });

  it("shows active session as selected in dropdown", () => {
    render(<MiniControlBar {...defaultProps} />);
    const switcher = screen.getByTestId("session-switcher") as HTMLSelectElement;
    expect(switcher.value).toBe("s1");
  });
});

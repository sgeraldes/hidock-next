import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecordingControls } from "../components/RecordingControls";

describe("RecordingControls", () => {
  const defaultProps = {
    isRecording: false,
    elapsedTime: 0,
    micActive: false,
    autoRecord: true,
    onStartRecording: vi.fn(),
    onStopRecording: vi.fn(),
    onToggleAutoRecord: vi.fn(),
  };

  it("shows start button when not recording", () => {
    render(<RecordingControls {...defaultProps} />);
    expect(screen.getByTestId("start-recording")).toBeInTheDocument();
  });

  it("shows stop button when recording", () => {
    render(<RecordingControls {...defaultProps} isRecording={true} />);
    expect(screen.getByTestId("stop-recording")).toBeInTheDocument();
  });

  it("calls onStartRecording when start clicked", () => {
    render(<RecordingControls {...defaultProps} />);
    fireEvent.click(screen.getByTestId("start-recording"));
    expect(defaultProps.onStartRecording).toHaveBeenCalled();
  });

  it("calls onStopRecording when stop clicked", () => {
    const onStop = vi.fn();
    render(
      <RecordingControls
        {...defaultProps}
        isRecording={true}
        onStopRecording={onStop}
      />,
    );
    fireEvent.click(screen.getByTestId("stop-recording"));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows elapsed time when recording", () => {
    render(
      <RecordingControls
        {...defaultProps}
        isRecording={true}
        elapsedTime={90}
      />,
    );
    expect(screen.getByText("1:30")).toBeInTheDocument();
  });

  it("shows mic status indicator", () => {
    render(<RecordingControls {...defaultProps} micActive={true} />);
    expect(screen.getByTestId("mic-indicator")).toBeInTheDocument();
  });

  it("shows auto-record toggle", () => {
    render(<RecordingControls {...defaultProps} />);
    expect(screen.getByTestId("auto-record-toggle")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SpeakerList } from "../components/SpeakerList";

describe("SpeakerList", () => {
  const defaultProps = {
    speakers: [
      { id: "sp1", name: "Speaker 1", displayName: null, segmentCount: 5 },
      { id: "sp2", name: "Alice", displayName: "Alice Smith", segmentCount: 3 },
    ],
    onRenameSpeaker: vi.fn(),
  };

  it("renders all speakers", () => {
    render(<SpeakerList {...defaultProps} />);
    expect(screen.getByText("Speaker 1")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("shows segment count for each speaker", () => {
    render(<SpeakerList {...defaultProps} />);
    expect(screen.getByText("5 segments")).toBeInTheDocument();
    expect(screen.getByText("3 segments")).toBeInTheDocument();
  });

  it("enters edit mode on speaker name click", () => {
    render(<SpeakerList {...defaultProps} />);
    fireEvent.click(screen.getByText("Speaker 1"));
    const input = screen.getByDisplayValue("Speaker 1");
    expect(input).toBeInTheDocument();
  });

  it("calls onRenameSpeaker when editing is confirmed", () => {
    render(<SpeakerList {...defaultProps} />);
    fireEvent.click(screen.getByText("Speaker 1"));
    const input = screen.getByDisplayValue("Speaker 1");
    fireEvent.change(input, { target: { value: "Bob" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(defaultProps.onRenameSpeaker).toHaveBeenCalledWith("sp1", "Bob");
  });

  it("cancels edit on Escape", () => {
    const onRename = vi.fn();
    render(<SpeakerList {...defaultProps} onRenameSpeaker={onRename} />);
    fireEvent.click(screen.getByText("Speaker 1"));
    const input = screen.getByDisplayValue("Speaker 1");
    fireEvent.change(input, { target: { value: "Bob" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
  });

  it("shows empty state when no speakers", () => {
    render(<SpeakerList speakers={[]} onRenameSpeaker={vi.fn()} />);
    expect(screen.getByText(/no speakers/i)).toBeInTheDocument();
  });

  it("displays displayName when available, falls back to name", () => {
    render(<SpeakerList {...defaultProps} />);
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });
});

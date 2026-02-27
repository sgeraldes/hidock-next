import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NotesPanel } from "../components/NotesPanel";

describe("NotesPanel", () => {
  const defaultProps = {
    notes: "Initial meeting notes",
    attachments: [
      { id: "a1", filename: "design.pdf", type: "file" as const },
      { id: "a2", filename: "screenshot.png", type: "screenshot" as const },
    ],
    onNotesChange: vi.fn(),
    onAddAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
  };

  it("renders the notes text area with content", () => {
    render(<NotesPanel {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("Initial meeting notes");
  });

  it("calls onNotesChange when typing", () => {
    render(<NotesPanel {...defaultProps} />);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Updated notes" } });
    expect(defaultProps.onNotesChange).toHaveBeenCalledWith("Updated notes");
  });

  it("displays attachment list", () => {
    render(<NotesPanel {...defaultProps} />);
    expect(screen.getByText("design.pdf")).toBeInTheDocument();
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
  });

  it("calls onRemoveAttachment when remove button clicked", () => {
    const onRemove = vi.fn();
    render(<NotesPanel {...defaultProps} onRemoveAttachment={onRemove} />);
    const removeButtons = screen.getAllByTestId("remove-attachment");
    fireEvent.click(removeButtons[0]);
    expect(onRemove).toHaveBeenCalledWith("a1");
  });

  it("shows empty state for attachments when none exist", () => {
    render(<NotesPanel {...defaultProps} attachments={[]} />);
    expect(screen.getByText(/no attachments/i)).toBeInTheDocument();
  });

  it("shows add attachment button", () => {
    render(<NotesPanel {...defaultProps} />);
    expect(screen.getByTestId("add-attachment-btn")).toBeInTheDocument();
  });
});

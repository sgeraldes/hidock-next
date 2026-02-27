import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ActionItemsPanel from "../components/ActionItemsPanel";

describe("ActionItemsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders action items with text and assignee", () => {
    render(
      <ActionItemsPanel
        items={[
          { id: "1", text: "Deploy to staging", assignee: "Bob", status: "open" },
          { id: "2", text: "Review PR #42", assignee: null, status: "open" },
        ]}
        onToggle={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(screen.getByText("Deploy to staging")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("Review PR #42")).toBeTruthy();
  });

  it("calls onToggle when checkbox clicked", () => {
    const onToggle = vi.fn();
    render(
      <ActionItemsPanel
        items={[
          { id: "a1", text: "Fix bug", assignee: null, status: "open" },
        ]}
        onToggle={onToggle}
        onAdd={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith("a1", "done");
  });

  it("shows completed items with checked state", () => {
    render(
      <ActionItemsPanel
        items={[
          { id: "a1", text: "Done task", assignee: null, status: "done" },
        ]}
        onToggle={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("unchecks a completed item", () => {
    const onToggle = vi.fn();
    render(
      <ActionItemsPanel
        items={[
          { id: "a1", text: "Done task", assignee: null, status: "done" },
        ]}
        onToggle={onToggle}
        onAdd={vi.fn()}
      />,
    );

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith("a1", "open");
  });

  it("shows empty state when no items", () => {
    render(
      <ActionItemsPanel items={[]} onToggle={vi.fn()} onAdd={vi.fn()} />,
    );

    expect(screen.getByText(/no action items/i)).toBeTruthy();
  });

  it("calls onAdd when add button clicked with input text", () => {
    const onAdd = vi.fn();
    render(
      <ActionItemsPanel
        items={[]}
        onToggle={vi.fn()}
        onAdd={onAdd}
      />,
    );

    const input = screen.getByPlaceholderText(/add action item/i);
    fireEvent.change(input, { target: { value: "New task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("New task");
  });

  it("clears input after adding", () => {
    render(
      <ActionItemsPanel
        items={[]}
        onToggle={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/add action item/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New task" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("");
  });
});

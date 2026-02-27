import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MeetingTypeEditor from "../components/MeetingTypeEditor";

const mockTypes = [
  {
    id: "mt-general",
    name: "General Meeting",
    description: "Standard meeting format",
    icon: "calendar",
    prompt_template: "Summarize the meeting.",
    is_default: 1,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "mt-standup",
    name: "Standup",
    description: "Daily standup",
    icon: "clock",
    prompt_template: "Summarize standup.",
    is_default: 1,
    created_at: "2026-01-01T00:00:00Z",
  },
];

describe("MeetingTypeEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the list of existing meeting types", () => {
    render(
      <MeetingTypeEditor
        meetingTypes={mockTypes}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText("General Meeting")).toBeTruthy();
    expect(screen.getByText("Standup")).toBeTruthy();
  });

  it("shows descriptions for meeting types", () => {
    render(
      <MeetingTypeEditor
        meetingTypes={mockTypes}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText("Standard meeting format")).toBeTruthy();
    expect(screen.getByText("Daily standup")).toBeTruthy();
  });

  it("renders the create form with name input", () => {
    render(
      <MeetingTypeEditor
        meetingTypes={mockTypes}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText("Type name")).toBeTruthy();
  });

  it("calls onCreate with form data when submitted", async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: "mt-new" });

    render(
      <MeetingTypeEditor
        meetingTypes={mockTypes}
        onCreate={onCreate}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Type name"), {
      target: { value: "Retrospective" },
    });
    fireEvent.change(screen.getByPlaceholderText("Description (optional)"), {
      target: { value: "Sprint retrospective" },
    });
    fireEvent.change(screen.getByPlaceholderText("Prompt template (optional)"), {
      target: { value: "Summarize the retro." },
    });

    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith({
        name: "Retrospective",
        description: "Sprint retrospective",
        prompt_template: "Summarize the retro.",
      });
    });
  });

  it("does not call onCreate if name is empty", () => {
    const onCreate = vi.fn();

    render(
      <MeetingTypeEditor
        meetingTypes={mockTypes}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByText("Create"));

    expect(onCreate).not.toHaveBeenCalled();
  });

  it("clears the form after successful creation", async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: "mt-new" });

    render(
      <MeetingTypeEditor
        meetingTypes={mockTypes}
        onCreate={onCreate}
      />,
    );

    const nameInput = screen.getByPlaceholderText("Type name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Retro" } });
    fireEvent.click(screen.getByText("Create"));

    await waitFor(() => {
      expect(nameInput.value).toBe("");
    });
  });

  it("renders empty state when no meeting types", () => {
    render(
      <MeetingTypeEditor
        meetingTypes={[]}
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText(/no custom meeting types/i)).toBeTruthy();
  });

  it("shows default badge for default types", () => {
    render(
      <MeetingTypeEditor
        meetingTypes={mockTypes}
        onCreate={vi.fn()}
      />,
    );

    const badges = screen.getAllByText("Default");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });
});

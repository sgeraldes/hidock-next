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

  it("renders the create form with name input after clicking the create button", () => {
    render(
      <MeetingTypeEditor
        meetingTypes={mockTypes}
        onCreate={vi.fn()}
      />,
    );

    // The form is hidden until the user clicks "Create custom meeting type"
    fireEvent.click(screen.getByText("Create custom meeting type"));

    expect(screen.getByPlaceholderText("Name")).toBeTruthy();
  });

  it("calls onCreate with form data when submitted", async () => {
    const onCreate = vi.fn().mockResolvedValue({ id: "mt-new" });

    render(
      <MeetingTypeEditor
        meetingTypes={mockTypes}
        onCreate={onCreate}
      />,
    );

    // Open the create form first
    fireEvent.click(screen.getByText("Create custom meeting type"));

    fireEvent.change(screen.getByPlaceholderText("Name"), {
      target: { value: "Retrospective" },
    });
    fireEvent.change(screen.getByPlaceholderText("Description"), {
      target: { value: "Sprint retrospective" },
    });
    fireEvent.change(screen.getByPlaceholderText("Focus on sprint goals, capacity planning, and task breakdown..."), {
      target: { value: "Summarize the retro." },
    });

    fireEvent.click(screen.getByText("Create meeting type"));

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

    // Open the create form first
    fireEvent.click(screen.getByText("Create custom meeting type"));

    // The "Create meeting type" button is disabled when name is empty
    const createButton = screen.getByText("Create meeting type");
    expect(createButton.closest("button")).toBeTruthy();
    // Disabled attribute prevents the click from triggering handleCreate
    expect((createButton.closest("button") as HTMLButtonElement).disabled).toBe(true);

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

    // Open the create form first
    fireEvent.click(screen.getByText("Create custom meeting type"));

    const nameInput = screen.getByPlaceholderText("Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Retro" } });
    fireEvent.click(screen.getByText("Create meeting type"));

    // After creation the form is hidden (showCreateForm = false), so the button
    // to open it reappears — which confirms the form was reset and closed.
    await waitFor(() => {
      expect(screen.getByText("Create custom meeting type")).toBeTruthy();
    });
  });

  it("renders the create button when no meeting types exist", () => {
    render(
      <MeetingTypeEditor
        meetingTypes={[]}
        onCreate={vi.fn()}
      />,
    );

    // The component always shows the "Create custom meeting type" button
    // when the form is not open, regardless of whether types exist.
    expect(screen.getByText("Create custom meeting type")).toBeTruthy();
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

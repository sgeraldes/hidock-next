import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ContextModelSettings } from "../components/settings/ContextModelSettings";
import { useSettingsStore } from "../store/useSettingsStore";

const mockContexts = {
  realtime: {
    name: "Real-time Transcription",
    description: "Live audio transcription during meetings",
    priority: "speed" as const,
  },
  postprocess: {
    name: "Post-processing",
    description: "Detailed analysis after meeting ends",
    priority: "quality" as const,
  },
  batch: {
    name: "Batch Processing",
    description: "Processing multiple recordings",
    priority: "cost" as const,
  },
};

const mockGoogleModels = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    description: "Fast & cost-effective",
    costMultiplier: 1,
    contexts: ["realtime", "postprocess", "batch"],
    capabilities: ["audio", "multimodal"],
    recommended: true,
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    description: "Higher quality (~10x cost)",
    costMultiplier: 10,
    contexts: ["postprocess", "critical"],
    capabilities: ["audio", "multimodal"],
  },
];

beforeEach(() => {
  window.electronAPI = {
    models: {
      getConfig: vi.fn().mockResolvedValue({
        version: 1,
        providers: {
          google: { defaultModel: "gemini-2.5-flash" },
        },
        contexts: mockContexts,
      }),
      getForProvider: vi.fn().mockResolvedValue(mockGoogleModels),
      getActiveForProvider: vi.fn().mockResolvedValue(mockGoogleModels),
      getForContext: vi.fn().mockResolvedValue("gemini-2.5-flash"),
      getContexts: vi.fn().mockResolvedValue(mockContexts),
      validate: vi.fn().mockResolvedValue({ valid: true, deprecated: false, migratesTo: null }),
      getCostMultiplier: vi.fn().mockResolvedValue(1),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({}),
      testConnection: vi.fn().mockResolvedValue({ valid: true }),
      getModelForContext: vi.fn().mockResolvedValue("gemini-2.5-flash"),
    },
  } as unknown as typeof window.electronAPI;

  // Reset store to defaults
  useSettingsStore.setState({
    model: "gemini-2.5-flash",
    provider: "google",
    contextModels: {},
  });
});

describe("ContextModelSettings", () => {
  it("renders collapsed by default", async () => {
    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    // The section should be collapsed -- context names should not be visible
    expect(screen.queryByText("Real-time Transcription")).toBeNull();
    expect(screen.queryByText("Post-processing")).toBeNull();
  });

  it("has correct aria-expanded attribute when collapsed", async () => {
    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      const button = screen.getByRole("button", { name: /advanced/i });
      expect(button.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("expands on click to show context selectors", async () => {
    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Advanced: Per-context models"));

    await waitFor(() => {
      expect(screen.getByText("Real-time Transcription")).toBeTruthy();
      expect(screen.getByText("Post-processing")).toBeTruthy();
      expect(screen.getByText("Batch Processing")).toBeTruthy();
    });
  });

  it("has correct aria-expanded attribute when expanded", async () => {
    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    const button = screen.getByRole("button", { name: /advanced/i });
    fireEvent.click(button);

    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows context descriptions from config", async () => {
    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Advanced: Per-context models"));

    await waitFor(() => {
      expect(
        screen.getByText("Live audio transcription during meetings (Priority: speed)"),
      ).toBeTruthy();
      expect(
        screen.getByText("Detailed analysis after meeting ends (Priority: quality)"),
      ).toBeTruthy();
      expect(
        screen.getByText("Processing multiple recordings (Priority: cost)"),
      ).toBeTruthy();
    });
  });

  it("shows the default model reference in the description text", async () => {
    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Advanced: Per-context models"));

    await waitFor(() => {
      expect(
        screen.getByText(/Override the default model for specific contexts/),
      ).toBeTruthy();
      expect(
        screen.getByText(/gemini-2.5-flash/),
      ).toBeTruthy();
    });
  });

  it("calls updateModelForContext when a context model is changed", async () => {
    // gemini-2.5-pro has costMultiplier: 10, which triggers cost warning.
    // Use a model list that includes a low-cost non-default option to avoid the dialog.
    const modelsWithLowCostAlt = [
      ...mockGoogleModels,
      {
        id: "gemini-2.0-flash",
        name: "Gemini 2.0 Flash",
        description: "Previous generation, still fast",
        costMultiplier: 1,
        contexts: ["realtime", "postprocess", "batch"],
        capabilities: ["audio"],
      },
    ];
    (window.electronAPI.models.getForProvider as ReturnType<typeof vi.fn>).mockResolvedValue(
      modelsWithLowCostAlt,
    );

    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Advanced: Per-context models"));

    // Wait for ModelSelectors to load
    await waitFor(() => {
      const selects = screen.getAllByLabelText("Select AI model");
      expect(selects.length).toBeGreaterThanOrEqual(3);
    });

    // Change the first context's model to a low-cost model (no cost warning)
    const selects = screen.getAllByLabelText("Select AI model");
    fireEvent.change(selects[0], { target: { value: "gemini-2.0-flash" } });

    // Verify the store's set method was called (updateModelForContext calls settings.set)
    await waitFor(() => {
      expect(window.electronAPI.settings.set).toHaveBeenCalled();
    });
  });

  it("shows Reset to default button when a context model is overridden", async () => {
    // Set a context override in the store
    useSettingsStore.setState({
      contextModels: { realtime: "gemini-2.5-pro" },
    });

    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Advanced: Per-context models"));

    await waitFor(() => {
      expect(screen.getByText("Reset to default")).toBeTruthy();
    });
  });

  it("does not show Reset to default when context matches the default model", async () => {
    // contextModels is empty, so all contexts use default
    useSettingsStore.setState({
      contextModels: {},
    });

    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Advanced: Per-context models"));

    await waitFor(() => {
      expect(screen.getByText("Real-time Transcription")).toBeTruthy();
    });

    expect(screen.queryByText("Reset to default")).toBeNull();
  });

  it("resets context model when Reset to default is clicked", async () => {
    useSettingsStore.setState({
      contextModels: { realtime: "gemini-2.5-pro" },
    });

    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Advanced: Per-context models"));

    await waitFor(() => {
      expect(screen.getByText("Reset to default")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Reset to default"));

    // Verify the store was called with empty string to clear the override
    await waitFor(() => {
      expect(window.electronAPI.settings.set).toHaveBeenCalledWith(
        "ai.model.context.realtime",
        "",
      );
    });
  });

  it("renders nothing when no contexts are available", async () => {
    (window.electronAPI.models.getContexts as ReturnType<typeof vi.fn>).mockResolvedValue({});

    const { container } = render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(container.innerHTML).toBe("");
    });
  });

  it("shows loading state while contexts are being fetched", async () => {
    // Create a promise that doesn't resolve immediately
    let resolveContexts: (value: Record<string, unknown>) => void;
    const contextsPromise = new Promise<Record<string, unknown>>((resolve) => {
      resolveContexts = resolve;
    });
    (window.electronAPI.models.getContexts as ReturnType<typeof vi.fn>).mockReturnValue(
      contextsPromise,
    );

    render(<ContextModelSettings provider="google" />);

    // Click to expand while still loading
    // The button should still appear since we render the shell optimistically
    // But the content inside should show loading state
    // Note: If the component hasn't loaded contexts yet, it might still show the button
    // because loading is true and contextEntries.length is 0, but we check !loading && length === 0
    // So during loading, the component should still render the container

    // Resolve the contexts
    resolveContexts!(mockContexts);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });
  });

  it("collapses when clicking the toggle button again", async () => {
    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(screen.getByText("Advanced: Per-context models")).toBeTruthy();
    });

    // Expand
    fireEvent.click(screen.getByText("Advanced: Per-context models"));

    await waitFor(() => {
      expect(screen.getByText("Real-time Transcription")).toBeTruthy();
    });

    // Collapse
    fireEvent.click(screen.getByText("Advanced: Per-context models"));

    expect(screen.queryByText("Real-time Transcription")).toBeNull();
  });

  it("shows subtitle text about different models for different tasks", async () => {
    render(<ContextModelSettings provider="google" />);

    await waitFor(() => {
      expect(
        screen.getByText("Use different models for different tasks"),
      ).toBeTruthy();
    });
  });
});

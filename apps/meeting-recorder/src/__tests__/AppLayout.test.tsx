import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AppLayout } from "../components/layout/AppLayout";

describe("AppLayout", () => {
  it("renders sidebar, main, and rightPanel slots", () => {
    const { container } = render(
      <AppLayout
        sidebar={<div data-testid="sidebar">sidebar</div>}
        main={<div data-testid="main">main</div>}
        rightPanel={<div data-testid="right">right</div>}
      />,
    );
    expect(container.querySelector("[data-testid='sidebar']")).toBeTruthy();
    expect(container.querySelector("[data-testid='main']")).toBeTruthy();
    expect(container.querySelector("[data-testid='right']")).toBeTruthy();
  });

  it("uses h-full (not h-screen) so it fits inside the shell layout", () => {
    const { container } = render(
      <AppLayout
        sidebar={<div />}
        main={<div />}
        rightPanel={<div />}
      />,
    );
    const outer = container.firstElementChild as HTMLElement;
    expect(outer.className).toContain("h-full");
    expect(outer.className).not.toContain("h-screen");
  });
});

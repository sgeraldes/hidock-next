import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NavSidebar } from "../components/layout/NavSidebar";

function renderWithRouter(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <NavSidebar />
    </MemoryRouter>,
  );
}

describe("NavSidebar", () => {
  it("renders three navigation items", () => {
    renderWithRouter("/");
    expect(screen.getByRole("link", { name: /dashboard/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /history/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /settings/i })).toBeTruthy();
  });

  it("links point to correct routes", () => {
    renderWithRouter("/");
    const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
    const historyLink = screen.getByRole("link", { name: /history/i });
    const settingsLink = screen.getByRole("link", { name: /settings/i });

    expect(dashboardLink.getAttribute("href")).toBe("/");
    expect(historyLink.getAttribute("href")).toBe("/history");
    expect(settingsLink.getAttribute("href")).toBe("/settings");
  });

  it("highlights the active route (dashboard)", () => {
    renderWithRouter("/");
    const dashboardLink = screen.getByRole("link", { name: /dashboard/i });
    expect(dashboardLink.getAttribute("aria-current")).toBe("page");
  });

  it("highlights the active route (history)", () => {
    renderWithRouter("/history");
    const historyLink = screen.getByRole("link", { name: /history/i });
    expect(historyLink.getAttribute("aria-current")).toBe("page");
  });

  it("highlights the active route (settings)", () => {
    renderWithRouter("/settings");
    const settingsLink = screen.getByRole("link", { name: /settings/i });
    expect(settingsLink.getAttribute("aria-current")).toBe("page");
  });
});

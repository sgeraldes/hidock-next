# Contributing to HiDock Universal Knowledge Hub

Welcome to the **HiDock Universal Knowledge Hub** - the fourth iteration and PRIMARY APPLICATION of HiDock Next. We're excited to have you contribute to building a universal knowledge extraction and management system that transforms ANY information source into actionable insights.

## Table of Contents

- [Welcome](#welcome)
- [Ways to Contribute](#ways-to-contribute)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Style Guide](#code-style-guide)
- [Testing Guidelines](#testing-guidelines)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Code Review Guidelines](#code-review-guidelines)
- [Project-Specific Guidelines](#project-specific-guidelines)
- [Getting Help](#getting-help)
- [Recognition](#recognition)

---

## Welcome

Thank you for your interest in contributing to the HiDock Universal Knowledge Hub! This Electron application is the culmination of HiDock Next's evolution - integrating device management, AI transcription, and insights extraction into a single, powerful intelligence system.

### What Makes This Special

This isn't just another audio app. We're building a **universal knowledge hub** that will eventually handle recordings, PDFs, presentations, documents, notes, calendar events, emails, Slack messages, and more. Currently focused on recordings (Wave 4 refactor), but architected from the ground up for multi-artifact support.

### How Contributions Make a Difference

Every contribution helps us move closer to the vision of a universal knowledge extraction system. Whether you're fixing bugs, improving accessibility, adding features, or enhancing documentation - you're helping build something that transforms how people manage and extract insights from their information.

### Code of Conduct

We follow the [Contributor Covenant Code of Conduct](../../.github/CODE_OF_CONDUCT.md). By participating, you agree to uphold a welcoming, inclusive, and respectful environment for all contributors.

---

## Ways to Contribute

### Code Contributions

- **New Features** - Implement functionality from our roadmap (auto-refresh, UI enhancements, etc.)
- **Bug Fixes** - Squash bugs and improve stability
- **Performance Improvements** - Optimize rendering, IPC communication, or data processing
- **Accessibility Enhancements** - Help us achieve WCAG 2.1 AA compliance
- **Tests** - Expand test coverage (unit, integration, accessibility)
- **Multi-Artifact Support** - Future: Help implement PDF, document, note, and email support

### Non-Code Contributions

- **Documentation Improvements** - Enhance guides, add examples, clarify instructions
- **Bug Reports** - Report issues with clear reproduction steps
- **Feature Requests** - Suggest new capabilities aligned with the Universal Knowledge Hub vision
- **Design Suggestions** - Propose UI/UX improvements
- **Translation** - Future: Multi-language support
- **User Testing** - Provide feedback on features and usability

---

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- **Node.js 18+** and npm
- **Git** for version control
- **Code editor** (VS Code recommended)
- **Basic knowledge** of TypeScript, React, and Electron

### Recommended VS Code Extensions

Install these extensions for the best development experience:

- **ESLint** - Code linting
- **Prettier** - Code formatting
- **TypeScript and JavaScript Language Features** - Built-in TypeScript support
- **Tailwind CSS IntelliSense** - Tailwind class autocomplete
- **Error Lens** - Inline error highlighting

### Development Environment Setup

```bash
# 1. Fork the repository on GitHub
#    Go to: https://github.com/sgeraldes/hidock-next
#    Click "Fork" button

# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/hidock-next.git
cd hidock-next

# 3. Add upstream remote (to sync with original repo)
git remote add upstream https://github.com/sgeraldes/hidock-next.git

# 4. Install root dependencies
npm install

# 5. Navigate to Electron app
cd apps/electron

# 6. Install Electron app dependencies
npm install

# 7. Start development server (in one terminal)
npm run dev

# 8. In another terminal, start Electron
npm run electron:dev
```

The app should now launch with hot module reloading (HMR) enabled. Changes to React components will update instantly.

### Optional: Ollama Setup (for RAG Chat)

If you want to work on RAG chat features:

```bash
# Install Ollama from https://ollama.ai

# Start Ollama service
ollama serve

# Pull required models
ollama pull nomic-embed-text  # For embeddings
ollama pull llama3.2          # For chat
```

---

## Development Workflow

### Before You Start

1. **Check existing issues** - Avoid duplicate work by reviewing [open issues](https://github.com/sgeraldes/hidock-next/issues)
2. **Open a discussion** - For major changes, open an issue to discuss your approach first
3. **Fork the repository** - Work in your own fork
4. **Create a feature branch** - Branch from `main`

```bash
# Create a feature branch
git checkout -b feature/your-feature-name

# Or for bug fixes
git checkout -b bugfix/issue-description
```

### While Developing

1. **Follow code style** - See [Code Style Guide](#code-style-guide) below
2. **Write tests** - All new functionality must include tests
3. **Update documentation** - Keep docs in sync with code changes
4. **Commit frequently** - Small, focused commits with clear messages
5. **Keep commits atomic** - Each commit should represent one logical change

### Testing Your Changes

Before submitting a PR, ensure all checks pass:

```bash
# Run linting
npm run lint

# Run type checking
npm run typecheck

# Run tests
npm test

# Run tests with coverage
npm run test:run

# Test the app manually
npm run dev  # In one terminal
# In another terminal:
cd apps/electron && npm run electron:dev
```

### Before Submitting PR

Checklist before creating a pull request:

- [ ] All tests pass locally
- [ ] Linting passes (`npm run lint`)
- [ ] Type checking passes (`npm run typecheck`)
- [ ] Code follows style guide
- [ ] Documentation updated (if needed)
- [ ] Manually tested in the app
- [ ] Accessibility tested (keyboard navigation, screen reader)
- [ ] Clear PR description written

---

## Code Style Guide

### TypeScript

We use **strict TypeScript** throughout the codebase.

**Rules:**
- **Explicit return types** on all functions
- **No `any` types** - Use `unknown` if type is truly dynamic
- **Interface over type** for object shapes
- **Prefer const** over let
- **Use optional chaining** (`?.`) and nullish coalescing (`??`)

**Good Example:**
```typescript
interface Recording {
  id: string
  filename: string
  duration?: number
  dateRecorded: Date
}

function getRecording(id: string): Recording | null {
  // implementation
  return null
}
```

**Bad Example:**
```typescript
function getRecording(id): any {
  // implementation
}
```

### React

We use **functional components** with hooks exclusively.

**Rules:**
- **Functional components only** (no class components)
- **Custom hooks** for reusable logic
- **Props interfaces** for all components
- **Meaningful component names** (PascalCase)
- **Single responsibility** - Keep components focused

**Good Example:**
```typescript
interface AudioPlayerProps {
  recordingId: string
  onPlaybackComplete?: () => void
}

export function AudioPlayer({
  recordingId,
  onPlaybackComplete
}: AudioPlayerProps): JSX.Element {
  // implementation
  return <div>Audio Player</div>
}
```

**Bad Example:**
```typescript
export function Player(props: any) {
  // implementation
}
```

### File Naming

Follow these conventions:

- **Components**: PascalCase (`AudioPlayer.tsx`)
- **Hooks**: camelCase with `use` prefix (`useUnifiedRecordings.ts`)
- **Utilities**: camelCase (`formatDuration.ts`)
- **Types**: PascalCase (`RecordingMetadata.ts`)
- **Services**: camelCase with descriptor (`recording-watcher.ts`)

### Formatting

**Line Length:** 120 characters (consistent with project root)

**Indentation:** 2 spaces (no tabs)

**Semicolons:** Required

**Quotes:** Single quotes for strings

**Trailing Commas:** Required in multi-line

**Automatic Formatting:**

We use Prettier for consistent formatting. Format your code before committing:

```bash
npm run format  # If format script exists
# Or let your editor auto-format on save
```

### Naming Conventions

**Variables:** camelCase
```typescript
const recordingList = []
const isLoading = false
```

**Constants:** UPPER_SNAKE_CASE
```typescript
const MAX_RETRIES = 3
const DEFAULT_TIMEOUT = 5000
```

**Functions:** camelCase, verb-first
```typescript
function getRecordings() {}
function handleClick() {}
function validateInput() {}
```

**Booleans:** is/has prefix
```typescript
const isLoading = true
const hasError = false
const shouldRefresh = true
```

**Event Handlers:** handle prefix
```typescript
function handleSubmit() {}
function handleDelete() {}
function handleRecordingSelect() {}
```

### IPC Channels

Use consistent naming for IPC channels:

```typescript
// Pattern: <domain>:<action>
'recording:new'
'recording:updated'
'download:complete'
'device:connected'
'transcription:started'
```

---

## Testing Guidelines

### Test Requirements

- **All new features** must include tests
- **Bug fixes** should include regression tests
- **Aim for 80%+ coverage** for new code
- **Accessibility tests** required for UI components

### Testing Framework

We use:

- **Vitest** - Unit and integration testing
- **@testing-library/react** - Component testing
- **jest-axe** - Accessibility testing
- **jsdom** - DOM simulation

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:run

# Run specific test file
npm test -- AudioPlayer.test.tsx

# Run performance tests
npm run test:performance
```

### Test Structure

Follow this pattern for component tests:

```typescript
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AudioPlayer } from './AudioPlayer'

describe('AudioPlayer', () => {
  it('should render audio controls', () => {
    render(<AudioPlayer recordingId="test-123" />)
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
  })

  it('should handle playback completion', async () => {
    const onComplete = vi.fn()
    render(<AudioPlayer recordingId="test-123" onPlaybackComplete={onComplete} />)

    // Simulate playback completion
    // Assert onComplete was called
  })

  it('should display recording duration', () => {
    render(<AudioPlayer recordingId="test-123" />)
    expect(screen.getByText(/duration:/i)).toBeInTheDocument()
  })
})
```

### Accessibility Testing

All new UI components must pass accessibility tests:

```typescript
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

describe('AccessibleComponent', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(<YourComponent />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })

  it('should be keyboard navigable', () => {
    render(<YourComponent />)
    const button = screen.getByRole('button')
    button.focus()
    expect(button).toHaveFocus()
  })

  it('should have proper ARIA labels', () => {
    render(<YourComponent />)
    expect(screen.getByLabelText(/recording name/i)).toBeInTheDocument()
  })
})
```

### Mocking IPC

When testing components that use IPC:

```typescript
import { vi } from 'vitest'

// Mock IPC in your test
vi.mock('@electron-toolkit/preload', () => ({
  electronAPI: {
    invoke: vi.fn(),
    on: vi.fn(),
    off: vi.fn()
  }
}))

// In your test
it('should call IPC to fetch recordings', async () => {
  const mockInvoke = vi.mocked(window.electronAPI.invoke)
  mockInvoke.mockResolvedValue([{ id: '1', filename: 'test.wav' }])

  render(<RecordingList />)

  expect(mockInvoke).toHaveBeenCalledWith('recording:getAll')
})
```

---

## Commit Message Guidelines

We follow **Conventional Commits** format.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation changes
- `style` - Code style changes (formatting, no logic change)
- `refactor` - Code refactoring (no feature/fix)
- `perf` - Performance improvements
- `test` - Adding or updating tests
- `chore` - Build process, dependencies, tooling

### Scopes

Use these scopes for the Electron app:

- `library` - Knowledge Library page
- `device` - Device management
- `chat` - RAG chat
- `calendar` - Calendar integration
- `waveform` - Audio waveform visualization
- `transcription` - AI transcription
- `ipc` - IPC communication
- `ui` - UI components
- `a11y` - Accessibility

### Examples

**Feature:**
```
feat(library): add auto-refresh on file system changes

Implemented fs.watch integration with recording-watcher service.
Auto-refresh triggers when new recordings are added to watched directory.

Closes #123
```

**Bug Fix:**
```
fix(waveform): resolve memory leak in audio buffer generation

Audio buffers were not being properly released after waveform generation,
causing memory to grow over time with many playbacks.

Fixes #456
```

**Documentation:**
```
docs(architecture): add IPC communication flow diagram

Added Mermaid diagram showing main ↔ renderer communication patterns.
Explains channel naming conventions and error handling.
```

**Refactor:**
```
refactor(library): extract filter logic to custom hook

Moved filter state and logic from Library component to useLibraryFilterManager hook.
Improves testability and reusability.
```

---

## Pull Request Process

### Before Submitting

Ensure your PR meets all requirements:

- [x] Code follows style guide
- [x] Tests pass (`npm test`)
- [x] Linting passes (`npm run lint`)
- [x] Type checking passes (`npm run typecheck`)
- [x] Documentation updated (if needed)
- [x] Commits follow conventional format
- [x] Branch is up to date with main

### PR Title Format

Use conventional commit format:

```
feat(library): add keyboard navigation support
fix(device): resolve sync count calculation error
docs(contributing): add accessibility testing section
```

### PR Description Template

Use this template for your PR description:

```markdown
## Description

[Clear description of what this PR does]

## Type of Change

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update

## Related Issues

Closes #[issue number]
Fixes #[issue number]

## Testing

[Describe how you tested this change]

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Accessibility tests added/updated
- [ ] Manually tested in the app
- [ ] Tested with keyboard navigation
- [ ] Tested with screen reader

## Screenshots (if applicable)

[Add screenshots for UI changes]

## Checklist

- [ ] My code follows the code style of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published
- [ ] I have checked my code for accessibility issues
```

### Review Process

1. **Maintainers will review** within 3-5 business days
2. **Address feedback promptly** - Respond to all review comments
3. **Squash commits if requested** - Keep commit history clean
4. **Once approved** - Maintainers will merge your PR

### After Merge

- Your contribution will be included in the next release
- You'll be credited in release notes
- Close any related issues if not automatically closed

---

## Reporting Bugs

### Before Reporting

1. **Check existing issues** - Search open and closed issues
2. **Try latest version** - Test on the `main` branch
3. **Verify it's not known** - Check README and documentation

### Bug Report Template

Use this template when reporting bugs:

```markdown
**Describe the bug**
A clear and concise description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '...'
3. Scroll down to '...'
4. See error

**Expected behavior**
A clear and concise description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Environment:**
 - OS: [e.g. Windows 11, macOS 14, Ubuntu 22.04]
 - Electron App Version: [e.g. 1.0.0]
 - Node Version: [e.g. 18.17.0]
 - Electron Version: [e.g. 33.2.0]

**Console Output**
If applicable, include console errors (View → Toggle Developer Tools → Console).

**Additional context**
Add any other context about the problem here.
```

---

## Requesting Features

### Feature Request Template

Use this template for feature requests:

```markdown
**Is your feature request related to a problem? Please describe.**
A clear and concise description of what the problem is.
Ex. I'm always frustrated when [...]

**Describe the solution you'd like**
A clear and concise description of what you want to happen.

**Describe alternatives you've considered**
A clear and concise description of any alternative solutions or features you've considered.

**Does this fit the Universal Knowledge Hub vision?**
- [ ] Applies to current recordings functionality
- [ ] Applies to future multi-artifact support (PDFs, docs, emails, notes, etc.)
- [ ] General UI/UX improvement
- [ ] Performance improvement
- [ ] Accessibility improvement
- [ ] AI/intelligence enhancement

**Additional context**
Add any other context or screenshots about the feature request here.

**Proposed Implementation (optional)**
If you have ideas about how this could be implemented, share them here.
```

---

## Code Review Guidelines

### For Reviewers

- **Be respectful and constructive** - Focus on the code, not the person
- **Explain reasoning** - Help contributors understand why changes are needed
- **Distinguish requirements from suggestions** - Make it clear what's blocking vs nice-to-have
- **Approve when satisfied** - Don't nitpick minor style issues
- **Use GitHub suggestions** - For small changes, suggest directly in review

### For Contributors

- **Don't take feedback personally** - Reviews improve code quality
- **Ask questions** - If feedback is unclear, ask for clarification
- **Respond to all comments** - Address each review comment
- **Make requested changes** - Or explain why you disagree
- **Be patient** - Reviews take time, especially for large PRs

---

## Project-Specific Guidelines

### Universal Knowledge Hub Vision

When contributing, keep in mind:

- **Current scope:** Recordings (audio files from HiDock devices and local files)
- **Future scope:** ANY artifact type (PDFs, docs, emails, notes, calendar, Slack, etc.)
- **Design for extensibility:** Consider how your code will work with future artifact types

Ask yourself: "Will this pattern work when we add PDFs? Documents? Notes?"

### Wave 4 Refactor (Current Focus)

Priority areas for contributions:

1. **Auto-refresh System** - File system watcher integration
2. **Waveform Loading** - Immediate visualization on selection
3. **UI/UX Enhancements** - Clear labels, responsive layout, polish
4. **Accessibility** - WCAG 2.1 AA compliance (keyboard nav, screen readers)
5. **Performance** - Large library handling, virtual scrolling

### Adding New Artifact Types (Future)

If contributing multi-artifact support:

1. **Review architecture docs** - Understand the universal extraction pipeline
2. **Follow artifact abstraction** - Don't hardcode recording-specific logic
3. **Ensure backward compatibility** - Existing recordings must continue to work
4. **Update database schema** - Add tables for new artifact types
5. **Add comprehensive tests** - Test extraction, chunking, and embedding
6. **Document the artifact type** - Explain how it fits the knowledge hub

### AI Provider Integration

When adding new AI providers:

1. **Implement provider interface** - See existing providers (Gemini, Ollama)
2. **Handle rate limiting** - Implement retry with exponential backoff
3. **Secure API key storage** - Use Electron's secure storage
4. **Provider-specific error handling** - Different providers, different errors
5. **Update provider selection UI** - Settings page dropdown

### IPC Communication

When adding new IPC channels:

1. **Follow naming convention** - `domain:action` (e.g., `recording:new`)
2. **Type request/response** - Use TypeScript interfaces
3. **Handle errors properly** - Try/catch in main, check response in renderer
4. **Document the channel** - Add to IPC documentation (future IPC_API.md)
5. **Test both directions** - Main → Renderer and Renderer → Main

---

## Getting Help

### Resources

- **Documentation:** Start with [README.md](README.md) and [ARCHITECTURE.md](ARCHITECTURE.md) (future)
- **Code:** Study existing code for patterns (e.g., `useUnifiedRecordings.ts`)
- **Root CLAUDE.md:** Project-wide conventions at `../../CLAUDE.md`
- **Tests:** Look at existing tests for examples

### Communication

- **GitHub Issues:** For bugs and feature requests
- **GitHub Discussions:** For questions and general discussion
- **Pull Request Comments:** For code-specific questions

### Common Questions

**Q: How do I test IPC communication?**
A: Mock the `window.electronAPI` object in your tests. See test examples above.

**Q: How do I add a new page?**
A: Create component in `src/pages/`, add route in `App.tsx`, update navigation.

**Q: Where should I put reusable logic?**
A: Create a custom hook in `src/hooks/` if it's React-specific, or a utility in `src/utils/` if pure TypeScript.

**Q: How do I access the database?**
A: Use IPC to call main process methods. Never access SQLite from renderer.

**Q: How do I test accessibility?**
A: Use jest-axe for automated checks, and manually test with keyboard and screen reader.

### Stuck?

1. **Read the documentation** - Many answers are in the docs
2. **Search existing issues/PRs** - Someone may have had the same problem
3. **Ask in GitHub Discussions** - Community can help
4. **Be specific** - What have you tried? What error do you get?

---

## Recognition

### Contributor Acknowledgment

Contributors will be:

- **Credited in release notes** - For each version
- **Added to CONTRIBUTORS.md** - If significant contributions (future file)
- **Mentioned in changelog** - For notable features/fixes
- **Recognized in discussions** - Community appreciation

### Types of Recognition

- **Code contributors** - Features, fixes, tests
- **Documentation contributors** - Guides, examples, clarity
- **Design contributors** - UI/UX improvements
- **Testing contributors** - Bug reports, QA, accessibility
- **Community contributors** - Helping others, discussions

---

## Thank You

Thank you for contributing to the HiDock Universal Knowledge Hub! Your contributions help us build a powerful, universal knowledge extraction and management system.

Together, we're creating something that will transform how people manage and extract insights from ALL their information sources - not just recordings, but eventually documents, notes, emails, and more.

**Happy coding!** 🚀

---

*For detailed technical information, see [README.md](README.md) and the root [CLAUDE.md](../../CLAUDE.md).*

*For project-wide contribution guidelines, see [docs/development/CONTRIBUTING.md](../../docs/development/CONTRIBUTING.md).*

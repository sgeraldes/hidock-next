# 🤝 Contributing to HiDock Next

## 1. Welcome to HiDock Next
We're excited to have you contribute to our open-source HiDock management platform with AI transcription capabilities.

## 2. Quick Start for Contributors 🚀

**New contributor?** Get started immediately:

```bash
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next

# Windows:
setup-windows.bat

# Linux/Mac:
chmod +x setup-unix.sh && ./setup-unix.sh

# Any Platform (Interactive):
python setup.py
# Choose option 2 (Developer)
```

These automated setup scripts handle everything you need for development.

## 📖 How to Contribute

### 1. 🎯 Areas We Need Help

**High Priority:**

- 🤖 **New AI Providers**: Expand our AI ecosystem beyond the current 11 providers
- 🔧 **Bug Fixes**: Help us squash bugs and improve stability
- 📱 **Mobile Support**: WebUSB mobile compatibility improvements
- 🧪 **Testing**: Increase test coverage across all applications

**Medium Priority:**

- 🎨 **UI/UX Improvements**: Enhance user experience and accessibility
- 📚 **Documentation**: Guides, tutorials, and API documentation
- 🌐 **Internationalization**: Multi-language support
- 🚀 **Performance**: Optimization and efficiency improvements

### 2. 📋 Before You Start

1. **Check existing issues** on [GitHub Issues](https://github.com/sgeraldes/hidock-next/issues)
2. **Join discussions** on [GitHub Discussions](https://github.com/sgeraldes/hidock-next/discussions)
3. **Read our documentation** in the [docs/](docs/) folder
4. **Set up your development environment** using the Quick Start above

### 3. 🛠️ Development Workflow

#### **Step 1: Fork and Clone**

```bash
# Fork the repository on GitHub first
git clone https://github.com/YOUR_USERNAME/hidock-next.git
cd hidock-next
git remote add upstream https://github.com/sgeraldes/hidock-next.git
```

#### **Step 2: Create a Feature Branch**

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b bugfix/issue-description
```

#### **Step 3: Make Changes**

- Follow our [Code Quality Standards](#-code-quality-standards)
- **Use TDD approach**: Write failing tests first, then implement
- Write comprehensive tests for new functionality (maintain 80% coverage)
- Update documentation as needed
- Ensure pre-commit hooks pass (automatically installed with developer setup)
- **For settings-related changes**: Add tests to appropriate `test_settings_*.py` files
- **For device communication**: Include both unit and integration tests
- **For GUI components**: Mock CustomTkinter components properly

#### **Step 4: Test Your Changes**

```bash
# Test desktop app (581 comprehensive tests)
cd hidock-desktop-app && python -m pytest  # Runs all tests with coverage

# Run specific test categories
pytest -m unit          # Unit tests only (~400 tests)
pytest -m integration   # Integration tests (~150 tests)
pytest -m device        # Device tests (~30 tests, requires hardware)

# Test web app
cd hidock-web-app && npm test

# Test pre-commit hooks (code quality)
pre-commit run --all-files

# Check coverage (must be 80%+)
pytest --cov=. --cov-report=html
```

#### **Step 5: Commit and Push**

```bash
git add .
git commit -m "feat: add your feature description"
git push origin feature/your-feature-name
```

#### **Step 6: Create Pull Request**

1. Go to GitHub and create a Pull Request
2. Fill out the PR template completely
3. Link any related issues
4. Wait for review and feedback

## 🎯 Code Quality Standards

### **Line Length**

- **120 characters** for all code (Python, TypeScript, JavaScript)
- Pre-commit hooks enforce this automatically

### **Python Code (Desktop App)**

- **Black** formatting with 120-char line length (auto-format on save)
- **Flake8** linting via `ms-python.flake8` extension (E203, W503 ignored for Black compatibility)
- **isort** import sorting with Black profile (auto-organize on save)
- **Pylint** for comprehensive code quality analysis (via `ms-python.pylint` extension or tasks)
- **Pylance** type checking with basic configuration (built into VS Code Python extension)
- **Type hints** required for new code

### **Modern VS Code Integration**

- **Standalone Extensions**: Each tool uses dedicated extensions for optimal performance
  - `ms-python.python` (Pylance built-in for type checking)
  - `ms-python.flake8` (fast style checking)
  - `ms-python.black-formatter` (code formatting)
  - `ms-python.isort` (import organization)
  - `ms-python.pylint` (comprehensive analysis)
- **Real-time Feedback**: Pylance + Flake8 provide immediate feedback while coding
- **On-demand Analysis**: Pylint available via VS Code tasks for comprehensive code quality checks
- **Automated Formatting**: Black + isort run on save with proper configuration

### **TypeScript/JavaScript Code**

- **ESLint** with React hooks rules
- **TypeScript** strict mode
- **Consistent naming** (camelCase for variables, PascalCase for components)

### **Testing Requirements**

- **80% minimum coverage** (enforced by pytest configuration)
- **TDD approach**: Write failing tests first (Red-Green-Refactor)
- **Unit tests** for all new functions with proper mocking
- **Integration tests** for component interactions
- **Mock-first strategy** for external dependencies
- **Test categories**: Use pytest markers (unit, integration, device, slow)
- **Comprehensive coverage**: Currently 581 tests in desktop app

## 📁 Project Structure

```folder
hidock-next/
├── hidock-desktop-app/     # Python desktop application
├── hidock-web-app/         # React web application
├── audio-insights-extractor/  # Standalone audio analysis tool
├── docs/                   # Project documentation
├── .pre-commit-config.yaml # Code quality hooks
└── setup.py               # Automated setup script
```

## 👥 Types of Contributions

### 🐛 **Bug Reports**

- Use the bug report template
- Include steps to reproduce
- Provide system information
- Add screenshots if helpful

### 💡 **Feature Requests**

- Use the feature request template
- Explain the problem it solves
- Describe your proposed solution
- Consider implementation complexity

### 📝 **Documentation**

- Fix typos and improve clarity
- Add examples and use cases
- Update outdated information
- Create new guides and tutorials

### 🔧 **Code Contributions**

- Follow the development workflow above
- Include tests for new features
- Update documentation as needed
- Follow our coding standards

## 🎮 AI Provider Development

**Want to add a new AI provider?** This is a high-impact contribution!

### Steps to Add a Provider

1. **Study existing providers** in `hidock-desktop-app/ai_service.py`
2. **Implement the provider class** following the `AIProvider` interface
3. **Add configuration** to settings and UI
4. **Write tests** with mock responses
5. **Update documentation** with setup instructions

### Provider Requirements

- Support for transcription and/or text analysis
- Error handling and fallback mechanisms
- Secure API key management
- Mock responses for development

## 🌟 Recognition

### **Contributor Hall of Fame**

We recognize significant contributors in our:

- README.md acknowledgments
- Release notes
- Community discussions

### **Recent Contributors & Achievements**

- **Comprehensive Settings Testing**: 24+ tests covering settings dialog functionality
- **Device Selector Bug Fix**: Proper enable/disable functionality implemented
- **Enhanced Error Handling**: Improved validation and error recovery
- **Performance Optimizations**: Background processing and intelligent caching
- **Test-Driven Development**: 581 comprehensive tests with 80% coverage requirement

### **Contribution Types We Value:**

- 🏆 Major features and architectural improvements
- 🔧 Bug fixes and stability improvements (like device selector fix)
- 📚 Documentation and tutorial creation
- 🧪 Test coverage and quality improvements (help us exceed 80%)
- 🎨 UI/UX enhancements (CustomTkinter components)
- 🌐 Accessibility and internationalization
- 🤖 New AI provider integrations (expand beyond current 11)
- ⚡ Performance optimizations (caching, background processing)

## 📞 Getting Help

### **Before Contributing:**

1. **Read the docs**: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
2. **Check existing issues**: Avoid duplicating work
3. **Ask questions**: Use GitHub Discussions

### **During Development:**

1. **Test failures**: Check [docs/TESTING.md](docs/TESTING.md) troubleshooting section
2. **Settings dialog issues**: Review `test_settings_*.py` files for examples
3. **Device communication**: Check device selector bug fix implementation
4. **Pre-commit hook issues**: Ensure `pip install -e ".[dev]"` was used (not requirements.txt)
5. **Coverage issues**: Use `pytest --cov=. --cov-report=html` to identify gaps

### **Common Development Issues:**

- **Import errors**: Ensure virtual environment and dev dependencies installed with `pip install -e ".[dev]"`
- **Test failures**: Check that CustomTkinter components are properly mocked
- **Coverage below 80%**: Add tests for uncovered code paths
- **Settings validation**: Follow temperature (0.0-2.0) and token (1-32000) ranges
- **Device selector**: Use `set_enabled()` method, not `configure(state=...)`
- **Dependencies**: Never use `requirements.txt` - all dependencies are in `pyproject.toml`

### **Need Help?**

- 💬 **Questions**: [GitHub Discussions](https://github.com/sgeraldes/hidock-next/discussions)
- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/sgeraldes/hidock-next/issues)
- 🧪 **Test Help**: Check existing test files for patterns and examples
- 📧 **Direct Contact**: Create an issue and we'll respond

## 📜 Code of Conduct

### **Our Standards**

- **Be respectful** and inclusive
- **Be constructive** in feedback
- **Be patient** with new contributors
- **Be collaborative** and helpful

### **Unacceptable Behavior**

- Harassment or discrimination
- Trolling or inflammatory comments
- Publishing private information
- Unprofessional conduct

## 📄 License

By contributing to HiDock Next, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

## 🚀 Ready to Contribute?

1. **⭐ Star** this repository
2. **🍴 Fork** the project
3. **📋 Pick** an issue or feature (check our 581-test suite for inspiration)
4. **🧪 Write tests first** (TDD approach - Red-Green-Refactor)
5. **💻 Code** your contribution (maintain 80% coverage)
6. **✅ Validate** with comprehensive testing and code quality checks
7. **🔄 Submit** a pull request with detailed test coverage

**Recent achievements to build upon:**

- ✅ 581 comprehensive tests implemented
- ✅ Settings dialog thoroughly tested (24+ tests)
- ✅ Device selector bug fixed with proper testing
- ✅ 80% coverage requirement established
- ✅ TDD workflow implemented

**Thank you for making HiDock Next better! 🎉**

---

*For detailed technical information, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) and [docs/TESTING.md](docs/TESTING.md)*

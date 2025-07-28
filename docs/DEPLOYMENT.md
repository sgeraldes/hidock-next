# HiDock Next - Deployment Guide

This guide covers deployment procedures for both the desktop and web applications of HiDock Next.

## Table of Contents

1. [Desktop Application Deployment](#desktop-application-deployment)
2. [Web Application Deployment](#web-application-deployment)
3. [Production Considerations](#production-considerations)
4. [Monitoring and Maintenance](#monitoring-and-maintenance)

## Desktop Application Deployment

### Prerequisites

- Python 3.8+ installed on target systems
- libusb libraries available on target systems
- HiDock device drivers (if required by OS)

### Development Build

For development and testing purposes:

```bash
# Clone repository
git clone https://github.com/sgeraldes/hidock-next.git
cd hidock-next

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run application
python main.py
```

### Distribution Package Creation

#### Using PyInstaller (Recommended)

1. **Install PyInstaller:**

   ```bash
   pip install pyinstaller
   ```

2. **Create executable:**

   ```bash
   # Single file executable
   pyinstaller --onefile --windowed --name "HiDock Next" main.py
   
   # Directory distribution (faster startup)
   pyinstaller --windowed --name "HiDock Next" main.py
   ```

3. **Include additional files:**

   ```bash
   pyinstaller --onefile --windowed \
     --add-data "icons:icons" \
     --add-data "themes:themes" \
     --name "HiDock Next" \
     main.py
   ```

#### Platform-Specific Considerations

**Windows:**

- Include libusb-1.0.dll in the distribution
- Consider code signing for security
- Create installer using NSIS or Inno Setup

**macOS:**

- Create .app bundle with proper Info.plist
- Handle Gatekeeper requirements
- Consider notarization for distribution

**Linux:**

- Include libusb development libraries
- Create .deb or .rpm packages
- Consider AppImage for universal distribution

### Installation Instructions

#### Windows Installation

1. Download the installer or executable
2. Run as administrator if required
3. Follow installation wizard
4. Install HiDock device drivers if prompted

#### macOS Installation

1. Download the .dmg file
2. Drag application to Applications folder
3. Grant necessary permissions in System Preferences
4. Install libusb via Homebrew if required

#### Linux Installation

1. Install libusb development packages:

   ```bash
   # Ubuntu/Debian
   sudo apt-get install libusb-1.0-0-dev
   
   # CentOS/RHEL
   sudo yum install libusb1-devel
   ```

2. Install the application package or run from source

## Web Application Deployment

### Prerequisites

- Node.js 18+ for building
- Modern web server for hosting
- HTTPS certificate (required for WebUSB)
- CDN for global distribution (optional)

### Build Process

1. **Install dependencies:**

   ```bash
   cd hidock-web-app
   npm install
   ```

2. **Configure environment:**

   ```bash
   # Create production environment file
   cp .env.example .env.production
   
   # Edit environment variables
   VITE_APP_NAME="HiDock Community"
   VITE_APP_VERSION="1.0.0"
   ```

3. **Build for production:**

   ```bash
   npm run build
   ```

4. **Preview build locally:**

   ```bash
   npm run preview
   ```

### Deployment Platforms

#### Vercel Deployment (Recommended)

1. **Install Vercel CLI:**

   ```bash
   npm install -g vercel
   ```

2. **Deploy:**

   ```bash
   vercel --prod
   ```

3. **Configure custom domain:**

   ```bash
   vercel domains add your-domain.com
   ```

#### Netlify Deployment

1. **Build and deploy:**

   ```bash
   # Install Netlify CLI
   npm install -g netlify-cli
   
   # Build project
   npm run build
   
   # Deploy
   netlify deploy --prod --dir=dist
   ```

2. **Configure redirects** (create `_redirects` file in `public/`):

   ```
   /*    /index.html   200
   ```

#### GitHub Pages Deployment

1. **Configure vite.config.ts:**

   ```typescript
   export default defineConfig({
     base: '/hidock-next/',
     // ... other config
   });
   ```

2. **Deploy using GitHub Actions:**

   ```yaml
   # .github/workflows/deploy.yml
   name: Deploy to GitHub Pages
   
   on:
     push:
       branches: [ main ]
   
   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3
         - uses: actions/setup-node@v3
           with:
             node-version: 18
         - run: npm ci
         - run: npm run build
         - uses: peaceiris/actions-gh-pages@v3
           with:
             github_token: ${{ secrets.GITHUB_TOKEN }}
             publish_dir: ./dist
   ```

#### Self-Hosted Deployment

1. **Build the application:**

   ```bash
   npm run build
   ```

2. **Configure web server (Nginx example):**

   ```nginx
   server {
       listen 443 ssl http2;
       server_name your-domain.com;
       
       ssl_certificate /path/to/certificate.crt;
       ssl_certificate_key /path/to/private.key;
       
       root /path/to/hidock-web-app/dist;
       index index.html;
       
       # Handle client-side routing
       location / {
           try_files $uri $uri/ /index.html;
       }
       
       # Security headers
       add_header X-Frame-Options DENY;
       add_header X-Content-Type-Options nosniff;
       add_header X-XSS-Protection "1; mode=block";
       
       # Caching for static assets
       location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
           expires 1y;
           add_header Cache-Control "public, immutable";
       }
   }
   ```

3. **Configure HTTPS** (required for WebUSB):

   ```bash
   # Using Let's Encrypt
   sudo certbot --nginx -d your-domain.com
   ```

### Environment Configuration

#### Production Environment Variables

Create `.env.production` with:

```bash
# Application Configuration
VITE_APP_NAME="HiDock Community"
VITE_APP_VERSION="1.0.0"
VITE_DEV_MODE=false

# API Configuration (optional)
VITE_GEMINI_API_KEY=""  # Leave empty for BYOK model

# Analytics (optional)
VITE_ANALYTICS_ID=""
```

#### Security Considerations

- Never include API keys in the build
- Use HTTPS for all production deployments
- Implement proper Content Security Policy
- Enable security headers
- Regular security updates

## Production Considerations

### Performance Optimization

#### Desktop Application

- Optimize startup time by lazy loading modules
- Implement efficient file caching
- Use threading for long-running operations
- Monitor memory usage and implement cleanup

#### Web Application

- Enable gzip/brotli compression
- Implement code splitting for large bundles
- Use CDN for static asset delivery
- Optimize images and media files
- Implement service worker for caching

### Monitoring and Analytics

#### Desktop Application

- Implement crash reporting (optional)
- Monitor performance metrics
- Track feature usage (with user consent)
- Provide feedback mechanisms

#### Web Application

- Monitor Core Web Vitals
- Track user interactions and errors
- Monitor API usage and performance
- Implement real user monitoring (RUM)

### Error Handling and Logging

#### Production Error Handling

- Implement comprehensive error boundaries
- Provide user-friendly error messages
- Log errors for debugging (without sensitive data)
- Implement automatic error reporting

#### Logging Configuration

```typescript
// Web app logging configuration
const logger = {
  level: process.env.NODE_ENV === 'production' ? 'error' : 'debug',
  enableConsole: process.env.NODE_ENV !== 'production',
  enableRemote: process.env.NODE_ENV === 'production',
};
```

### Security Measures

#### Desktop Application Security

- Code signing for executables
- Secure storage of user settings
- Input validation and sanitization
- Secure USB communication

#### Web Application Security

- HTTPS enforcement
- Content Security Policy implementation
- XSS and CSRF protection
- Secure API key handling

### Backup and Recovery

#### Desktop Application

- User data backup procedures
- Settings export/import functionality
- Recovery from corrupted configurations
- Update rollback mechanisms

#### Web Application

- Static asset backup
- Configuration backup
- Database backup (if applicable)
- Disaster recovery procedures

## Monitoring and Maintenance

### Health Monitoring

#### Web Application Monitoring

```javascript
// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION,
  });
});
```

#### Performance Monitoring

- Monitor response times
- Track error rates
- Monitor resource usage
- Set up alerting for issues

### Update Procedures

#### Desktop Application Updates

1. Version management with semantic versioning
2. Automated update checking
3. Incremental update distribution
4. Rollback procedures for failed updates

#### Web Application Updates

1. Blue-green deployment strategy
2. Automated deployment pipelines
3. Feature flags for gradual rollouts
4. Monitoring during deployments

### Maintenance Tasks

#### Regular Maintenance

- Security updates and patches
- Dependency updates
- Performance optimization
- Bug fixes and improvements

#### Scheduled Tasks

- Log rotation and cleanup
- Performance report generation
- Security audit procedures
- Backup verification

### Support and Documentation

#### User Support

- Comprehensive user documentation
- Troubleshooting guides
- FAQ and common issues
- Community support channels

#### Developer Support

- API documentation
- Deployment guides
- Contributing guidelines
- Issue tracking and resolution

## Troubleshooting

### Common Deployment Issues

#### Desktop Application

- **libusb not found**: Install development libraries
- **Permission errors**: Run with appropriate privileges
- **Device not detected**: Check drivers and permissions

#### Web Application

- **WebUSB not working**: Ensure HTTPS and supported browser
- **Build failures**: Check Node.js version and dependencies
- **CORS issues**: Configure server headers properly

### Debug Procedures

1. **Check logs** for error messages
2. **Verify environment** configuration
3. **Test with minimal setup** to isolate issues
4. **Check browser console** for web application issues
5. **Validate device connections** for hardware issues

### Getting Help

- Check documentation and troubleshooting guides
- Search existing issues on GitHub
- Create detailed issue reports with logs
- Engage with community support channels

## Conclusion

This deployment guide provides comprehensive instructions for deploying both desktop and web applications of HiDock Next. Follow the appropriate sections based on your deployment needs and target platforms.

For additional support or questions, please refer to the project documentation or create an issue on GitHub.

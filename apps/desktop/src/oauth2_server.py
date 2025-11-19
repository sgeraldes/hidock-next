# oauth2_server.py
"""
Localhost OAuth2 Callback Server.

Implements a temporary HTTP server on localhost to handle OAuth2 redirect callbacks.
This is the standard approach for desktop applications performing OAuth2 authentication.

Architecture:
1. Desktop app starts local HTTP server on http://localhost:PORT
2. App opens browser to OAuth provider's authorization URL
3. User logs in and grants permissions
4. OAuth provider redirects browser to http://localhost:PORT/callback?code=...
5. Local server captures the authorization code
6. Server returns success page to browser
7. App uses authorization code to get access token
8. Server shuts down

Security:
- Localhost is trusted (no TLS needed)
- Random port selection if default is busy
- Server automatically shuts down after receiving callback
- 2-minute timeout to prevent hanging
"""

import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional
from urllib.parse import parse_qs, urlparse

from config_and_logger import logger


class OAuth2CallbackHandler(BaseHTTPRequestHandler):
    """
    HTTP request handler for OAuth2 callback.

    Captures the authorization code from the redirect URL.
    """

    # Class-level variables to store callback results
    authorization_code: Optional[str] = None
    state: Optional[str] = None
    error: Optional[str] = None
    error_description: Optional[str] = None

    def do_GET(self):
        """Handle GET request from OAuth provider redirect."""
        try:
            # Parse URL and query parameters
            parsed_url = urlparse(self.path)
            query_params = parse_qs(parsed_url.query)

            # LOG EVERYTHING for debugging
            logger.info("OAuth2Server", "callback", "=== CALLBACK RECEIVED ===")
            logger.info("OAuth2Server", "callback", f"Path: {parsed_url.path}")
            logger.info("OAuth2Server", "callback", f"Full URL path: {self.path}")
            logger.info("OAuth2Server", "callback", f"Query string: {parsed_url.query}")
            logger.info("OAuth2Server", "callback", f"Parsed params: {query_params}")
            logger.info("OAuth2Server", "callback", f"Has 'code': {'code' in query_params}")
            logger.info("OAuth2Server", "callback", f"Has 'error': {'error' in query_params}")

            # Handle favicon requests (ignore them)
            if parsed_url.path == "/favicon.ico":
                logger.debug("OAuth2Server", "callback", "Ignoring favicon request")
                self.send_response(404)
                self.end_headers()
                return

            # Check for authorization code
            if "code" in query_params:
                OAuth2CallbackHandler.authorization_code = query_params["code"][0]

                # Optional: Capture state parameter for verification
                if "state" in query_params:
                    OAuth2CallbackHandler.state = query_params["state"][0]

                logger.info("OAuth2Server", "callback", "Authorization code received successfully")

                # Send success response to browser
                self.send_response(200)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.end_headers()

                success_html = """
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authentication Successful</title>
                    <style>
                        body {
                            font-family: 'Segoe UI', Arial, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .container {
                            text-align: center;
                            background: white;
                            padding: 50px;
                            border-radius: 20px;
                            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                        }
                        h1 {
                            color: #28a745;
                            font-size: 36px;
                            margin-bottom: 20px;
                        }
                        .checkmark {
                            font-size: 72px;
                            color: #28a745;
                        }
                        p {
                            font-size: 18px;
                            color: #666;
                            margin-top: 20px;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="checkmark">✓</div>
                        <h1>Authentication Successful!</h1>
                        <p>You can close this window and return to HiDock Desktop.</p>
                    </div>
                </body>
                </html>
                """
                self.wfile.write(success_html.encode("utf-8"))

            # Check for error
            elif "error" in query_params:
                OAuth2CallbackHandler.error = query_params["error"][0]

                if "error_description" in query_params:
                    OAuth2CallbackHandler.error_description = query_params["error_description"][0]

                logger.error(
                    "OAuth2Server",
                    "callback",
                    f"OAuth error: {OAuth2CallbackHandler.error} - {OAuth2CallbackHandler.error_description}",
                )

                # Send error response to browser
                self.send_response(400)
                self.send_header("Content-type", "text/html; charset=utf-8")
                self.end_headers()

                error_html = f"""
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Authentication Failed</title>
                    <style>
                        body {{
                            font-family: 'Segoe UI', Arial, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
                        }}
                        .container {{
                            text-align: center;
                            background: white;
                            padding: 50px;
                            border-radius: 20px;
                            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                        }}
                        h1 {{
                            color: #dc3545;
                            font-size: 36px;
                            margin-bottom: 20px;
                        }}
                        .error-icon {{
                            font-size: 72px;
                            color: #dc3545;
                        }}
                        p {{
                            font-size: 18px;
                            color: #666;
                            margin-top: 20px;
                        }}
                        .error-details {{
                            margin-top: 20px;
                            padding: 15px;
                            background: #f8f9fa;
                            border-radius: 10px;
                            font-family: monospace;
                            color: #dc3545;
                        }}
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="error-icon">✗</div>
                        <h1>Authentication Failed</h1>
                        <p>There was an error during authentication.</p>
                        <div class="error-details">
                            {OAuth2CallbackHandler.error}: {OAuth2CallbackHandler.error_description or 'Unknown error'}
                        </div>
                        <p>Please close this window and try again.</p>
                    </div>
                </body>
                </html>
                """
                self.wfile.write(error_html.encode("utf-8"))

            else:
                # Unexpected callback (no code or error)
                logger.warning(
                    "OAuth2Server",
                    "callback",
                    f"Received callback with no code or error. Path: {self.path}, Params: {query_params}",
                )
                self.send_response(400)
                self.send_header("Content-type", "text/plain")
                self.end_headers()
                self.wfile.write(b"Invalid callback parameters")

        except Exception as e:
            logger.error("OAuth2Server", "callback", f"Error handling callback: {e}")
            self.send_response(500)
            self.send_header("Content-type", "text/plain")
            self.end_headers()
            self.wfile.write(f"Server error: {e}".encode("utf-8"))

    def log_message(self, format, *args):
        """Override to suppress default HTTP server logs."""
        # Log ALL requests for debugging
        logger.debug("OAuth2Server", "http", f"HTTP Request: {format % args}")


class OAuth2LocalServer:
    """
    Local HTTP server for handling OAuth2 callbacks.

    Usage:
        server = OAuth2LocalServer(port=8080)
        server.start()

        # Open browser to OAuth URL
        webbrowser.open(auth_url)

        # Wait for callback
        code = server.wait_for_code(timeout=120)

        # Use code to get access token
        server.stop()
    """

    def __init__(self, port: int = 8080, max_port_attempts: int = 10):
        """
        Initialize OAuth2 local server.

        Args:
            port: Preferred port number (default 8080)
            max_port_attempts: Max number of ports to try if preferred is busy
        """
        self.port = self._find_available_port(port, max_port_attempts)
        self.server: Optional[HTTPServer] = None
        self.thread: Optional[threading.Thread] = None

        logger.info("OAuth2Server", "init", f"Server will use port {self.port}")

    def _find_available_port(self, preferred_port: int, max_attempts: int) -> int:
        """Find an available port starting from preferred port."""
        for port in range(preferred_port, preferred_port + max_attempts):
            try:
                # Try to bind to the port
                sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                sock.bind(("localhost", port))
                sock.close()
                logger.info("OAuth2Server", "port", f"Port {port} is available")
                return port
            except OSError:
                logger.debug("OAuth2Server", "port", f"Port {port} is busy, trying next...")
                continue

        # If all ports are busy, use the preferred port and hope for the best
        logger.warning("OAuth2Server", "port", f"All ports busy, using {preferred_port} anyway")
        return preferred_port

    def start(self):
        """Start the HTTP server in a background thread."""
        try:
            # Reset class-level variables
            OAuth2CallbackHandler.authorization_code = None
            OAuth2CallbackHandler.state = None
            OAuth2CallbackHandler.error = None
            OAuth2CallbackHandler.error_description = None

            # Create HTTP server
            self.server = HTTPServer(("localhost", self.port), OAuth2CallbackHandler)

            # Start server in background thread
            self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
            self.thread.start()

            logger.info("OAuth2Server", "start", f"Server started on http://localhost:{self.port}")

        except Exception as e:
            logger.error("OAuth2Server", "start", f"Failed to start server: {e}")
            raise

    def wait_for_code(self, timeout: int = 120) -> str:
        """
        Wait for authorization code from OAuth callback.

        This is a blocking call that waits until:
        - Authorization code is received (returns code)
        - Error is received (raises exception)
        - Timeout is reached (raises exception)

        Args:
            timeout: Maximum time to wait in seconds (default 120 = 2 minutes)

        Returns:
            Authorization code string

        Raises:
            TimeoutError: If timeout is reached
            Exception: If OAuth error is received
        """
        start_time = time.time()
        check_interval = 0.5  # Check every 0.5 seconds

        logger.info("OAuth2Server", "wait", f"Waiting for OAuth callback (timeout: {timeout}s)")

        while time.time() - start_time < timeout:
            # Check for authorization code
            if OAuth2CallbackHandler.authorization_code:
                code = OAuth2CallbackHandler.authorization_code
                logger.info("OAuth2Server", "wait", "Authorization code received")
                return code

            # Check for error
            if OAuth2CallbackHandler.error:
                error = OAuth2CallbackHandler.error
                error_desc = OAuth2CallbackHandler.error_description or "Unknown error"
                logger.error("OAuth2Server", "wait", f"OAuth error: {error} - {error_desc}")
                raise Exception(f"OAuth error: {error} - {error_desc}")

            # Sleep before next check
            time.sleep(check_interval)

        # Timeout reached
        logger.error("OAuth2Server", "wait", f"Timeout after {timeout}s")
        raise TimeoutError(f"OAuth callback timeout after {timeout} seconds")

    def stop(self):
        """Stop the HTTP server."""
        if self.server:
            try:
                logger.info("OAuth2Server", "stop", "Shutting down server")
                self.server.shutdown()
                self.server.server_close()
                self.server = None
                logger.info("OAuth2Server", "stop", "Server stopped successfully")
            except Exception as e:
                logger.error("OAuth2Server", "stop", f"Error stopping server: {e}")

    def get_redirect_uri(self) -> str:
        """Get the redirect URI for this server."""
        return f"http://localhost:{self.port}/callback"


# Testing interface
if __name__ == "__main__":
    print("=== OAuth2 Local Server Test ===\n")

    # Start server
    server = OAuth2LocalServer(port=8080)
    print(f"Redirect URI: {server.get_redirect_uri()}\n")

    server.start()
    print("Server started successfully!")
    print(f"Visit: http://localhost:{server.port}/callback?code=TEST_CODE_123\n")
    print("Waiting for callback (60 seconds)...\n")

    try:
        code = server.wait_for_code(timeout=60)
        print(f"✓ Received authorization code: {code}\n")
    except TimeoutError:
        print("✗ Timeout waiting for callback\n")
    except Exception as e:
        print(f"✗ Error: {e}\n")
    finally:
        server.stop()
        print("Server stopped.")

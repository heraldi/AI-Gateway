/**
 * Content script for claude.ai
 * Notifies background when page loads (auto-extract trigger).
 */
(function () {
  // Signal to background that we're on a claude.ai page and logged in
  const checkLoggedIn = () => {
    const isLoggedIn =
      document.querySelector('[data-testid="user-menu"]') ||
      document.querySelector('.nav-profile') ||
      document.cookie.includes('sessionKey');

    if (isLoggedIn) {
      chrome.runtime.sendMessage({ type: 'CLAUDE_LOGGED_IN' }).catch(() => {});
    }
  };

  // Run after DOM settles
  setTimeout(checkLoggedIn, 2000);
})();

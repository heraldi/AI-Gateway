/**
 * Content script for chatgpt.com / chat.openai.com
 */
(function () {
  const checkLoggedIn = () => {
    const isLoggedIn =
      document.querySelector('[data-testid="profile-button"]') ||
      document.querySelector('nav[aria-label="Chat history"]') ||
      document.cookie.includes('next-auth');

    if (isLoggedIn) {
      chrome.runtime.sendMessage({ type: 'CHATGPT_LOGGED_IN' }).catch(() => {});
    }
  };

  setTimeout(checkLoggedIn, 2000);
})();

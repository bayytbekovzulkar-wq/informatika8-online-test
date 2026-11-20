import React, { useEffect, useRef } from 'react';

/**
 * Компонент Cloudflare Turnstile.
 * Отображается автоматически, если в настройках задан TURNSTILE_SITE_KEY.
 */
export default function TurnstileWidget({ siteKey, onVerify }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!siteKey) return;

    function renderWidget() {
      if (!window.turnstile || !containerRef.current) return;
      if (widgetIdRef.current !== null) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'light',
        callback: (token) => onVerify(token),
        'expired-callback': () => onVerify(''),
        'error-callback': () => onVerify('')
      });
    }

    if (window.turnstile) {
      renderWidget();
      return;
    }

    const existingScript = document.querySelector('script[data-turnstile="1"]');
    if (existingScript) {
      existingScript.addEventListener('load', renderWidget);
      return () => existingScript.removeEventListener('load', renderWidget);
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.turnstile = '1';
    script.onload = renderWidget;
    document.head.appendChild(script);

    return () => {
      if (window.turnstile && widgetIdRef.current !== null) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore
        }
      }
    };
  }, [siteKey, onVerify]);

  if (!siteKey) return null;
  return <div ref={containerRef} style={{ margin: '0.5rem 0' }} />;
}

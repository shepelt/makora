import React from 'react';
import { createRoot } from 'react-dom/client';
import { Meteor } from 'meteor/meteor';
import { App } from '/imports/ui/App';

// Load mobile console (eruda) for debugging on iPad/mobile
// Enable via settings or ?debug URL parameter
const urlParams = new URLSearchParams(window.location.search);
if (Meteor.settings?.public?.enableMobileConsole || urlParams.has('debug')) {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/eruda';
  script.onload = () => {
    window.eruda?.init();
    console.log('[DEBUG] Eruda mobile console initialized');
  };
  document.body.appendChild(script);
}

Meteor.startup(() => {
  const container = document.getElementById('react-target');
  const root = createRoot(container);
  root.render(<App />);
});

(() => {
  "use strict";
  const panel = document.getElementById("onboardingPanel");
  if (!panel) return;

  panel.classList.add("onboardingProduct");
  panel.innerHTML = `
    <div class="onboardingHero">
      <div class="onboardingLogo" aria-hidden="true"><img src="/icon.svg" alt=""></div>
      <p class="onboardingKicker">Private live translation</p>
      <h2 id="onboardingTitle">Talk to anyone.<br>Keep your language.</h2>
      <p class="onboardingLead">Lingua Relay translates a private two-person video call, voice call, or chat while each person speaks naturally.</p>
    </div>
    <div class="onboardingFeatureList">
      <div class="onboardingFeature"><span class="featureGlyph" aria-hidden="true">◉</span><div><strong>Speak naturally</strong><p>Live captions and optional translated voice keep the conversation moving.</p></div></div>
      <div class="onboardingFeature"><span class="featureGlyph" aria-hidden="true">↗</span><div><strong>Share one private link</strong><p>The other person joins without creating an account.</p></div></div>
      <div class="onboardingFeature"><span class="featureGlyph" aria-hidden="true">✓</span><div><strong>Private by design</strong><p>Rooms are limited to two people and expire instead of becoming permanent public spaces.</p></div></div>
    </div>
    <div class="onboardingModeStrip" aria-label="Conversation modes">
      <div><span aria-hidden="true">▣</span><strong>Video</strong></div>
      <div><span aria-hidden="true">◉</span><strong>Voice</strong></div>
      <div><span aria-hidden="true">✦</span><strong>Chat</strong></div>
    </div>
    <p class="onboardingHint">Sign in below to create your first private conversation.</p>
  `;
})();

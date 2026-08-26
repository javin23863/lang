(() => {
  "use strict";
  const panel = document.getElementById("onboardingPanel");
  const authPanel = document.getElementById("authPanel");
  if (!panel) return;

  panel.classList.add("onboardingProduct");
  panel.innerHTML = `
    <div class="onboardingProgress" aria-label="Onboarding progress">
      <span class="active"></span><span></span><span></span>
    </div>
    <div class="onboardingSlides">
      <section class="onboardingSlide active" data-onboarding-step="0">
        <div class="onboardingHero">
          <div class="onboardingLogo" aria-hidden="true"><img src="/icon.svg" alt=""></div>
          <p class="onboardingKicker">Private live translation</p>
          <h2 id="onboardingTitle">Talk to anyone.<br>Keep your language.</h2>
          <p class="onboardingLead">Lingua Relay translates a private two-person video call, voice call, or chat while each person speaks naturally.</p>
        </div>
        <div class="onboardingModeStrip" aria-label="Conversation modes">
          <div><span aria-hidden="true">▣</span><strong>Video</strong></div>
          <div><span aria-hidden="true">◉</span><strong>Voice</strong></div>
          <div><span aria-hidden="true">✦</span><strong>Chat</strong></div>
        </div>
      </section>
      <section class="onboardingSlide" data-onboarding-step="1" hidden>
        <div class="onboardingHero compactOnboardingHero">
          <div class="onboardingStepIcon" aria-hidden="true">✓</div>
          <p class="onboardingKicker">Private by design</p>
          <h2>One room.<br>Two people.</h2>
          <p class="onboardingLead">Create a room, share one invitation, and talk. The other person does not need an account to join.</p>
        </div>
        <div class="onboardingFeatureList">
          <div class="onboardingFeature"><span class="featureGlyph" aria-hidden="true">↗</span><div><strong>Share one private link</strong><p>Send it with the system share sheet, WhatsApp, LINE, copy, or QR.</p></div></div>
          <div class="onboardingFeature"><span class="featureGlyph" aria-hidden="true">2</span><div><strong>Two-person rooms</strong><p>Rooms are intentionally limited to one conversation partner.</p></div></div>
          <div class="onboardingFeature"><span class="featureGlyph" aria-hidden="true">◌</span><div><strong>Temporary by default</strong><p>Rooms expire instead of becoming permanent public spaces.</p></div></div>
        </div>
      </section>
      <section class="onboardingSlide" data-onboarding-step="2" hidden>
        <div class="onboardingHero compactOnboardingHero">
          <div class="onboardingStepIcon" aria-hidden="true">◉</div>
          <p class="onboardingKicker">Ready when you are</p>
          <h2>Choose your language.<br>Start talking.</h2>
          <p class="onboardingLead">Set your default language pair once. You can change it before every new conversation.</p>
        </div>
        <div class="onboardingFeatureList">
          <div class="onboardingFeature"><span class="featureGlyph" aria-hidden="true">A</span><div><strong>Your language stays yours</strong><p>Each person selects the language they want to speak and read.</p></div></div>
          <div class="onboardingFeature"><span class="featureGlyph" aria-hidden="true">≋</span><div><strong>Captions when useful</strong><p>See live translated text during calls or use a full translated chat.</p></div></div>
          <div class="onboardingFeature"><span class="featureGlyph" aria-hidden="true">◎</span><div><strong>Permissions only when needed</strong><p>Microphone and camera access are requested when you use those features.</p></div></div>
        </div>
      </section>
    </div>
    <div class="onboardingActions">
      <button type="button" class="onboardingBack" data-onboarding-back hidden>Back</button>
      <button type="button" class="onboardingNext" data-onboarding-next>Continue</button>
      <button type="button" class="onboardingNext" data-onboarding-start hidden>Get started</button>
    </div>
    <p class="onboardingHint">Creating a room requires sign-in. Joining someone else's invitation does not.</p>
  `;

  const slides = [...panel.querySelectorAll("[data-onboarding-step]")];
  const dots = [...panel.querySelectorAll(".onboardingProgress span")];
  const back = panel.querySelector("[data-onboarding-back]");
  const next = panel.querySelector("[data-onboarding-next]");
  const start = panel.querySelector("[data-onboarding-start]");
  let step = 0;

  function renderStep(nextStep, focus = false) {
    step = Math.max(0, Math.min(slides.length - 1, nextStep));
    slides.forEach((slide, index) => {
      const active = index === step;
      slide.hidden = !active;
      slide.classList.toggle("active", active);
    });
    dots.forEach((dot, index) => dot.classList.toggle("active", index <= step));
    back.hidden = step === 0;
    next.hidden = step === slides.length - 1;
    start.hidden = step !== slides.length - 1;
    if (focus) (step === slides.length - 1 ? start : next).focus();
  }

  next.addEventListener("click", () => renderStep(step + 1, true));
  back.addEventListener("click", () => renderStep(step - 1, true));
  start.addEventListener("click", () => {
    authPanel?.scrollIntoView?.({behavior: "smooth", block: "center"});
    setTimeout(() => authPanel?.querySelector("a,button")?.focus?.(), 280);
  });

  panel.addEventListener("keydown", event => {
    if (event.key === "ArrowRight" && step < slides.length - 1) renderStep(step + 1, true);
    if (event.key === "ArrowLeft" && step > 0) renderStep(step - 1, true);
  });

  renderStep(0);
})();

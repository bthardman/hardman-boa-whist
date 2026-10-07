<script lang="ts">
  // Shown while connecting to the game server. On the free plan the server naps when nobody's
  // playing and takes up to a minute to wake, so this keeps people company in the meantime.
  import { onDestroy, onMount } from 'svelte';
  import { AvatarChoice } from '../../shared/types';
  import { getAvatarData } from '../avatarData';
  import { serverUrl } from '../socket';

  /** True after a refresh/reconnect mid-session: the server is awake, we're just catching up. */
  export let reconnecting = false;

  const faces = (Object.values(AvatarChoice).filter((c) => c !== AvatarChoice.UNDEFINED) as AvatarChoice[]).map(
    (c) => getAvatarData(c).avatar1
  );
  const messages = [
    'Waking up the table…',
    'Shuffling the deck…',
    'Polishing the trumps…',
    'Finding everyone a seat…',
    'Dealing you in…'
  ];

  /** Only appear if connecting takes a moment, so an awake server doesn't flash this up. */
  const SHOW_AFTER_MS = 700;
  const LONG_WAIT_MS = 15_000;

  let visible = false;
  let messageIndex = 0;
  let longWait = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  let messageTimer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  /** Pokes the server so a sleeping one starts waking straight away; repeats until it answers. */
  async function wakeServer() {
    while (!stopped) {
      try {
        const res = await fetch(`${serverUrl}/awake`, { cache: 'no-store' });
        if (res.ok && (await res.json())?.ok) return;
      } catch {
        /* still asleep (or offline): try again shortly */
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  onMount(() => {
    timers.push(setTimeout(() => (visible = true), SHOW_AFTER_MS));
    timers.push(setTimeout(() => (longWait = true), LONG_WAIT_MS));
    messageTimer = setInterval(() => (messageIndex = (messageIndex + 1) % messages.length), 2600);
    if (!reconnecting) void wakeServer();
  });

  onDestroy(() => {
    stopped = true;
    timers.forEach(clearTimeout);
    if (messageTimer) clearInterval(messageTimer);
  });
</script>

<main class="wake" class:visible aria-busy="true" aria-live="polite">
  {#if visible}
    <div class="stage">
      <div class="orbit" aria-hidden="true">
        {#each faces as src, i}
          <div class="seat" style="--a: {(360 / faces.length) * i}deg; --i: {i}">
            <img {src} alt="" />
          </div>
        {/each}
      </div>
      <img class="logo" src="/logo/logo.png" alt="Hardman Boa-Whist" />
    </div>

    <div class="status">
      <span class="spinner" aria-hidden="true"></span>
      {#key messageIndex}
        <p class="message">{reconnecting ? 'Loading the table…' : messages[messageIndex]}</p>
      {/key}
    </div>
    {#if longWait && !reconnecting}
      <p class="hint">The game server naps when nobody's playing and can take up to a minute to wake. Nearly there!</p>
    {/if}
  {/if}
</main>

<style>
  .wake {
    height: 100dvh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: clamp(1rem, 4vh, 2rem);
    padding: 24px;
    text-align: center;
    overflow: hidden;
  }
  .stage {
    --r: clamp(110px, min(32vw, 26vh), 210px);
    --face: clamp(40px, min(11vw, 9vh), 72px);
    position: relative;
    width: calc(var(--r) * 2 + var(--face));
    height: calc(var(--r) * 2 + var(--face));
    display: grid;
    place-items: center;
    animation: fade-in 500ms ease-out both;
  }
  .logo {
    position: relative;
    width: calc(var(--r) * 1.45);
    height: auto;
    filter: drop-shadow(0 10px 24px rgba(3, 14, 24, 0.45));
    animation: bob 2.8s ease-in-out infinite;
  }
  /* The faces ride round the logo; each one counter-rotates so it stays upright. */
  .orbit {
    position: absolute;
    inset: 0;
    animation: spin 16s linear infinite;
  }
  .seat {
    position: absolute;
    left: 50%;
    top: 50%;
    width: var(--face);
    height: var(--face);
    margin: calc(var(--face) / -2) 0 0 calc(var(--face) / -2);
    transform: rotate(var(--a)) translateY(calc(var(--r) * -1)) rotate(calc(var(--a) * -1));
  }
  .seat img {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid rgba(234, 244, 251, 0.8);
    box-shadow: 0 8px 18px rgba(3, 14, 24, 0.4);
    animation:
      counter-spin 16s linear infinite,
      pop 2.4s ease-in-out infinite;
    animation-delay: 0s, calc(var(--i) * 0.3s);
  }
  .status {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    min-height: 2rem;
  }
  .spinner {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 3px solid rgba(143, 221, 251, 0.25);
    border-top-color: var(--ice);
    animation: spin 0.9s linear infinite;
  }
  .message {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(1.3rem, 4.5vw, 1.7rem);
    color: var(--on-felt);
    animation: fade-in 300ms ease-out both;
  }
  .hint {
    margin: -0.5rem 0 0;
    max-width: 36ch;
    color: var(--on-felt-muted);
    animation: fade-in 500ms ease-out both;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes counter-spin {
    to {
      transform: rotate(-360deg);
    }
  }
  @keyframes pop {
    0%,
    100% {
      scale: 1;
    }
    50% {
      scale: 1.12;
    }
  }
  @keyframes bob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-6px);
    }
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .orbit,
    .seat img,
    .logo {
      animation: none;
    }
  }
</style>

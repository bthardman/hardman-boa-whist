<script lang="ts">
  // Lobby sheet for visitors: play under your own name, with an initials picture.
  import { createEventDispatcher, onMount } from 'svelte';
  import { roomId } from '../store';
  import { socket } from '../socket';
  import { MAX_GUEST_NAME_LENGTH, cleanGuestName } from '../../shared/players';
  import { guestAvatarUrl } from '../avatarUtils';
  import { persistGuestName, readGuestName } from '../utils/playerPrefsCookies';
  import Icon from './ui/Icon.svelte';

  const dispatch = createEventDispatcher<{ close: void }>();
  let name = readGuestName() ?? '';
  let input: HTMLInputElement;

  $: clean = cleanGuestName(name);
  $: showHint = name.trim().length > 0 && !clean;

  function close() {
    dispatch('close');
  }
  function join() {
    if (!clean) return;
    persistGuestName(clean);
    socket.emit('join_as_guest', { roomId: $roomId, name: clean });
    close();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
  onMount(() => input?.focus());
</script>

<svelte:window on:keydown={onKeydown} />

<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="guest-title">
  <button class="overlay-dismiss" type="button" aria-label="Close" on:click={close}></button>
  <form class="sheet guest" on:submit|preventDefault={join}>
    <header>
      <h3 id="guest-title">Join as a guest</h3>
      <button class="close" type="button" aria-label="Close" on:click={close}><Icon name="close" /></button>
    </header>
    <p class="intro">Visiting? Play under your own name. (Family: tap your picture instead.)</p>

    <label class="field">
      <span>Your name</span>
      <input
        bind:this={input}
        bind:value={name}
        maxlength={MAX_GUEST_NAME_LENGTH}
        autocomplete="given-name"
        autocapitalize="words"
        enterkeyhint="go"
        aria-invalid={showHint}
      />
    </label>
    {#if showHint}
      <p class="hint">Up to {MAX_GUEST_NAME_LENGTH} letters or numbers, and not a family member's or computer player's name.</p>
    {:else if clean}
      <p class="preview"><img src={guestAvatarUrl(clean)} alt="" /><span>You'll play as <strong>{clean}</strong></span></p>
    {/if}

    <button class="btn btn-primary btn-block" type="submit" disabled={!clean}>Join the table</button>
  </form>
</div>

<style>
  .guest {
    width: min(100%, 420px);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .close {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .close:hover {
    background: var(--paper-line);
  }
  .intro {
    margin: 0.4rem 0 1rem;
    color: var(--ink-soft);
  }
  .field {
    display: grid;
    gap: 0.35rem;
    font-weight: 700;
  }
  input {
    min-height: 48px;
    padding: 0 0.9rem;
    border: 1.5px solid var(--paper-line);
    border-radius: 12px;
    background: white;
    color: var(--ink);
    font: inherit;
    font-weight: 600;
    font-size: 1.1rem;
  }
  input:focus {
    outline: none;
    border-color: var(--ice-strong);
    box-shadow: 0 0 0 3px var(--ice-dim);
  }
  input[aria-invalid='true'] {
    border-color: var(--heart);
  }
  .hint {
    margin: 0.5rem 0 0;
    color: #a5202f;
    font-size: 0.92rem;
  }
  .preview {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.6rem 0 0;
    color: var(--ink-soft);
  }
  .preview img {
    width: 36px;
    height: 36px;
    border-radius: 50%;
  }
  .preview strong {
    color: var(--ink);
  }
  .btn-block {
    margin-top: 1.1rem;
  }
</style>

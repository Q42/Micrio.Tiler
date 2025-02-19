<script lang="ts">
	import { state, notifications, notify } from './lib/state';
	import { formatBytes, formatDuration } from './lib/utils';
	import { API } from './lib/api';
	//import Dev from './dev';

	import { fade } from 'svelte/transition';

	import { faArrowLeft, faArrowRight, faArrowRightToBracket, faCheck, faCheckCircle, faCopy, faExclamationTriangle, faMicrochip, faRotateLeft, faSpinner, faXmark } from '@fortawesome/free-solid-svg-icons';

	import Fa from 'svelte-fa';

	import Logo from './components/Logo.svelte';
	import Progress from './components/Progress.svelte';
	import OptionTree from './components/OptionTree.svelte';

	let loggingIn:boolean = false;
	let wasLoggedIn:boolean = false;
	let showTerminal:boolean = false;
	let folderSlug:string = '';

	const isDev = /localhost/.test(location.href);

	$:processingCompleted = $state?.job?.status == 'complete';
	$:loading = (!$state || loggingIn || ($state.job && !processingCompleted)) && !isDev;
	$:selectedGroup = $state?.groupSlug ? $state.groups?.find(g => g.slug == $state.groupSlug) : undefined;

	$: { if($state?.account) {
		loggingIn = false;
		if(!$state.groups) API.emit('getGroups');
	} else if(wasLoggedIn) {
		notify('Succesfully logged out');
		wasLoggedIn = false;
	}}

	$: { if($state?.groups && $state?.account && !wasLoggedIn) {
		notify('Logged in as '+$state.account);
		wasLoggedIn = true;
	}}

	$: { if($state?.error) notify($state.error, true); }

	let copied:boolean = false;
	function copyLoginLink() {
		if(!$state?.loginUrl) return;
		navigator.clipboard.writeText($state.loginUrl);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	function copyDestination() {
		if(!$state?.destination) return;
		navigator.clipboard.writeText($state.destination);
		copied = true;
		setTimeout(() => copied = false, 2000);
	}

	const getCompressed = () => {
		const perc = Math.round((1-($state!.job!.bytesResult / $state!.job!.bytesSource))*100);
		return perc > 0 ? '-' + perc : '+' + (-1*perc);
	}

	/** @ts-ignore*/
	//if(isDev) window.__uploader = Dev;

	const buttonClass = `rounded-8px h-[46px] text-center inline-block whitespace-pre border-transparent border-[1px] px-24px py-10px font-semibold transition-all bg-[#1a1a1a] hover:border-green-500 hover:text-green-500 min-w-[120px] disabled:opacity-50 disabled:pointer-events-none`;
	const selectClass = `w-[400px] rounded-8px px-12px py-10px border-transparent focus:border-green-500 border-[1px] overflow-hidden`;
	const h4Class = 'text-black-400 text-small uppercase mb-4px mt-16px';

	$:percFiles = $state?.job ? $state.job.numProcessed / $state.files.length : 0;
	$:percUpload = $state?.job?.numUploads ? $state.job.numUploaded / $state.job.numUploads : 0;
	$:percWeighed = (percFiles*2 + percUpload)/3;
	$:percDone = percWeighed == 1 ? processingCompleted ? percWeighed : percWeighed * .99 : percWeighed * .95;

</script>

<main class="w-640px select-none">
	<h1 class="mb-32px font-semibold leading-normal"><Logo style="mr-8px align-[6px]" animating={loading} /> Micrio Uploader</h1>
	{#if $state}
		{#if $state.account && $state.groups}
			<h3 class="mb-32px">Hello, {$state.account}.</h3>
			<div class="fixed top-16px right-16px">
				{#if $state.job}
					<button class={buttonClass} on:click={() => showTerminal = !showTerminal} class:!text-green-300={showTerminal} class:!border-green-300={showTerminal}>Output <Fa class="inline-block ml-8px" icon={faMicrochip} /></button>
				{/if}
				{#if !$state.job || processingCompleted}
					<button class={buttonClass} on:click={() => API.emit('logout')}>Log out <Fa class="inline-block ml-8px" icon={faArrowRightToBracket} /></button>
				{/if}
			</div>
			{#if !$state.job}
				<div class="mb-16px">
				{#if !$state.destination}
					<div class="mb-8px">
						<h4 class={h4Class}>Select group</h4>
						<select bind:value={$state.groupSlug} class={selectClass}>
							<option value="">-</option>
							{#each $state.groups as g}<option value={g.slug}>{g.name}</option>{/each}
						</select>
					</div>
					{#if selectedGroup}
						<div class="mb-16px">
							<h4 class={h4Class}>Select destination folder</h4>
							<select bind:value={folderSlug} class={selectClass}>
								<option value="">-</option>
								<OptionTree folders={selectedGroup.folders} baseSlug={$state.groupSlug} />
							</select>
						</div>
						{#if folderSlug}
							<button class={buttonClass} on:click={() => API.emit('destination', folderSlug)}>Continue <Fa class="inline-block ml-8px" icon={faArrowRight} /></button>
						{/if}
					{/if}
				{:else}
					<h4 class={h4Class}>Destination folder</h4>
					<div class="flex gap-8px mb-24px">
						<input class="h-[46px] w-full font-monospace text-normal px-8px bg-black-800 rounded-8px block flex-1 text-center" readonly value={$state.destination} /> <button class={buttonClass} class:!text-green-300={copied} class:!border-green-300={copied} on:click={copyDestination}>Cop{copied ? 'ied' : 'y'} <Fa class="inline-block ml-8px" icon={copied ? faCheck : faCopy} /></button>

					</div>
					<button class={buttonClass} on:click={() => API.emit('destination')}><Fa class="inline-block mr-8px" icon={faArrowLeft} /> Back</button>

					<button class={buttonClass} on:click={() => API.emit('selectFiles')}>{$state.files.length ? $state.files.length + ' files selected' : 'Select files'}</button>
					<button disabled={!$state.files.length} class={buttonClass} on:click={() => API.emit('start')}>Start</button>
					{#if selectedGroup?.hasOmni}
						<div class="text-center mt-24px leading-46px cursor-pointer px-16px py-4px mx-auto w-fit">
							<input type="checkbox" checked={$state.type == 'omni'} id="omni" on:change={() => API.emit('isOmni', $state.type != 'omni')} class="mr-8px align-[-1px]" /><label class="cursor-pointer" for="omni">Process as a 360&deg; object</label>
						</div>
					{/if}
				{/if}
				</div>
			{:else}
				{#if showTerminal}
					<textarea cols="60" rows="5" readonly class="block font-monospace my-16px p-16px rounded-8px mx-auto resize-none">{$state.terminal}</textarea>
				{:else}
					<Progress title={$state.job.status} asPercent current={percDone} />
				{/if}
				{#if processingCompleted}
					<div class="mb-24px max-w-[520px] mx-auto text-normal">
						<p class="mb-8px">
							Uploaded {$state.files.length} image{$state.files.length == 1 ? '' : 's'} in {formatDuration(Math.round((Date.now() - $state.job.started)/1000))}s, {formatBytes($state.job.bytesSource)} <Fa icon={faArrowRight} class="inline" /> {formatBytes($state.job.bytesResult)} ({getCompressed()}%).
						</p>
						<p class="mb-8px">
							Refresh the folder in your dashboard to see the results.
						</p>
					</div>
					<button disabled={!$state.files.length} class={buttonClass} on:click={() => API.emit('reset')}>Add more... <Fa class="inline-block ml-8px" icon={faRotateLeft} /></button>
				{/if}
			{/if}
		{:else if !$state.account}
			{#if !$state.loginUrl}
				<button class={buttonClass} disabled={loggingIn} on:click={() => { API.emit('login'); loggingIn = true; }}>{#if loggingIn}<Fa icon={faSpinner} class="inline-block relative spinning" />{:else}Log in{/if}</button>
			{:else}
				Open this link to continue your login process:
				<input class="h-[46px] my-16px w-full font-monospace text-normal px-8px bg-black-800 rounded-8px block flex-1 text-center" readonly value={$state.loginUrl} />
				<button class={buttonClass} class:!text-green-300={copied} class:!border-green-300={copied} on:click={copyLoginLink}>Cop{copied ? 'ied' : 'y'} <Fa class="inline-block ml-8px" icon={copied ? faCheck : faCopy} /></button>
			{/if}
		{/if}
	{/if}
</main>

{#each $notifications as n (n.id)}<div transition:fade
	class="fixed bottom-[16px] left-1/2 -translate-x-1/2 rounded-8px px-16px py-4px shadow-md w-11/12 sm:w-auto text-white text-center flex items-center z-30"
	class:bg-green-700={!n.isError} class:bg-black-700={n.isError}>
	<Fa icon={n.isError ? faExclamationTriangle : faCheckCircle} class="h-32px mr-16px"/>
	<span class="overflow-ellipsis overflow-hidden flex-1">{n.message}</span>
	{#if n.isError}<button class="ml-16px w-120px h-32px" on:click={() => notifications.update(l => l.filter(e => e.id != n.id))}><Fa class="inline" icon={faXmark} /></button>{/if}
</div>{/each}

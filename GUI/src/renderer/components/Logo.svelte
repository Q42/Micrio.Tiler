<script lang="ts">
	import { onDestroy } from 'svelte';

	export let animating:boolean = false;
	export let size:('S'|'L') = 'S';
	export let style:string = '';

	const numSteps = 6;

	let currStep = 0;
	let to:any;
	let toStop:boolean = false;

	const stop = () => {
		toStop = false;
		clearInterval(to);
	}

	const start = () => {
		if(toStop) return toStop = false;
		stop();
		to = setInterval(() => {
			if(toStop && currStep%2==0) stop();
			else currStep++;
		}, 850);
	}

	onDestroy(stop);

	$: {
		if(animating) start();
		else toStop = true;
	}

</script>

<figure id="logo" class="mix-blend-lighten align-middle rotate-45 {size == 'S' ? 'h-24px w-24px' : 'h-42px w-42px sm:h-90px sm:w-90px'} overflow-hidden relative inline-block {style}">{#each [0,1,2,3,4,5] as i}
	<span data-step={(i+currStep)%numSteps} class="absolute w-full h-full top-0 left-0 pointer-events-none even:bg-white odd:bg-black-1000"></span>
{/each}</figure>

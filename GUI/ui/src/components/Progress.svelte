<script lang="ts">
	export let title:string|undefined = undefined;
	export let total:number = 1;
	export let current:number = 0;
	export let asPercent:boolean = false;

	$: perc = total > 0 ? current / total : 0;
</script>

{#if title}<h4 class="text-black-400 text-small uppercase mb-8px">{title}</h4>{/if}
<div class="relative w-[460px] text-small leading-24px mb-16px mx-auto border-[1px] border-black-700 h-[46px] rounded-8px overflow-hidden bg-black-800">
	<div class="h-full bg-green-500 transition-[width]" class:bg-green-300={perc==1} style="width:{perc*100}%;"></div>
	<span class="absolute top-0px left-1/2 -translate-x-1/2 leading-[46px]">{#if asPercent}{Math.round(current / total * 100)}%{:else}{current} / {total}{/if}</span>
</div>

<script lang="ts">
	import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

	export let icon: IconDefinition;
	export let style: string = '';

	$: [w, h, , , d] = icon.icon;
</script>

<svg
	class={$$props.class || ''}
	{style}
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 {w} {h}"
	width="1em"
	height="1em"
	fill="currentColor"
>
	<path {d} />
</svg>

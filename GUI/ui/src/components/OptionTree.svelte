<script lang="ts">
	import type { Folder } from '../../../app/src/types';

	export let folders:Folder[] = [];
	export let baseSlug:string = '';
	export let baseName:string = '';
	export let depth:number = 0;
</script>

{#each folders as f}
	<option class="max-w-[400px] overflow-hidden" value={baseSlug+'/'+f.slug}>{baseName ? baseName+' > ':''}{f.name}</option>
	<svelte:self folders={f.children} baseSlug={baseSlug+'/'+f.slug} baseName={(baseName ? baseName+' > ':'')+f.name} depth={depth+1} />
{/each}

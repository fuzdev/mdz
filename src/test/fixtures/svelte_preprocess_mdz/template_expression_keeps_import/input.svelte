<script lang="ts">
	import Mdz from '@fuzdev/mdz/Mdz.svelte';
	import Foo from '../Foo.svelte';
</script>

<Mdz content="**bold**" />
<Foo comp={Mdz} />

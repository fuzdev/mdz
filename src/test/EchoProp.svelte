<script lang="ts">
	// test-only component: echoes a pass-through prop into its output so a
	// render test can assert the Component branch forwarded the attribute
	const {msg}: {msg?: string} = $props();
</script>

<span data-echo>{msg}</span>

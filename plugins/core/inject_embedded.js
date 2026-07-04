const fs = require('fs');
const path = 'fs/dist/index.html';
let html = fs.readFileSync(path, 'utf8');

const injection = `
<script>
if (window.location.href.includes('embedded=true')) {
    document.documentElement.classList.add('is-embedded');
}
</script>
<style>
html.is-embedded .v-navigation-drawer,
html.is-embedded .v-app-bar {
    display: none !important;
}
html.is-embedded .v-main {
    padding-top: 0 !important;
    padding-left: 0 !important;
}
html.is-embedded {
    overflow: hidden !important;
}
</style>
`;

if (!html.includes('is-embedded')) {
    html = html.replace('</head>', injection + '\n</head>');
    fs.writeFileSync(path, html);
    console.log('Injected embedded logic.');
} else {
    console.log('Already injected.');
}

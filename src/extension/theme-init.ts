// Pre-paint theme: applied before stylesheets to avoid a flash.
// External (not inline) so it complies with the Manifest V3 CSP.
try {
    if (localStorage.getItem('ali-theme') === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
} catch {
    // Storage blocked; the page script applies the theme later.
}

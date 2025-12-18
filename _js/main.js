const tooltip = document.querySelector('.info-tooltip');
if (tooltip) {
  tooltip.addEventListener('mousemove', (event) => {
    const rect = tooltip.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    tooltip.style.setProperty('--tooltip-x', `${x}px`);
    tooltip.style.setProperty('--tooltip-y', `${y}px`);
  });
}

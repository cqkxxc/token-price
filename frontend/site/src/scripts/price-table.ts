// 供应商比价表格的共享排序行为：首页抽屉和模型详情页均适用。
document.addEventListener('click', (event) => {
  const target = event.target as Element | null;
  const control = target?.closest<HTMLButtonElement>('[data-price-sort]');
  if (!control) return;

  const table = control.closest<HTMLTableElement>('.drawer-table');
  const tbody = table?.tBodies[0];
  const header = control.closest<HTMLTableCellElement>('th');
  if (!table || !tbody || !header) return;

  const field = control.dataset.priceSort;
  if (!field) return;

  const wasActive = header.classList.contains('active');
  const ascending = wasActive ? !header.classList.contains('asc') : true;
  const attribute = `data-${field}-price`;
  const rows = Array.from(tbody.rows);

  rows.sort((a, b) => {
    const aValue = Number(a.getAttribute(attribute));
    const bValue = Number(b.getAttribute(attribute));
    const compared = aValue - bValue;
    const byPrice = ascending ? compared : -compared;
    return byPrice || String(a.dataset.supplier || '').localeCompare(String(b.dataset.supplier || ''));
  });
  rows.forEach((row) => tbody.appendChild(row));

  table.querySelectorAll<HTMLTableCellElement>('th.dt-sortable').forEach((th) => {
    const active = th === header;
    th.classList.toggle('active', active);
    th.classList.toggle('asc', active && ascending);
    th.classList.toggle('desc', active && !ascending);
    th.setAttribute('aria-sort', active ? (ascending ? 'ascending' : 'descending') : 'none');
  });
});

const workloadNumber = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const workloadPriceText = (value: number): string => {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = amount === 0 || Math.abs(amount) >= 0.01
    ? amount.toFixed(2)
    : amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `¥${formatted}`;
};

function updateWorkload(comparison: HTMLElement) {
  const inputControl = comparison.querySelector<HTMLInputElement>('[data-workload-input]');
  const outputControl = comparison.querySelector<HTMLInputElement>('[data-workload-output]');
  if (!inputControl || !outputControl) return;
  const inputVolume = workloadNumber(inputControl.value);
  const outputVolume = workloadNumber(outputControl.value);

  comparison.querySelectorAll<HTMLElement>('[data-workload-total]').forEach((element) => {
    const inputPrice = workloadNumber(element.dataset.inputPrice || '0');
    const outputPrice = workloadNumber(element.dataset.outputPrice || '0');
    element.textContent = workloadPriceText(inputPrice * inputVolume + outputPrice * outputVolume);
  });

  const tableRoutes = Array.from(comparison.querySelectorAll<HTMLTableRowElement>(
    '.drawer-table tbody tr[data-price-route]',
  ));
  tableRoutes.forEach((route) => {
    const inputPrice = workloadNumber(route.dataset.inputPrice || '0');
    const outputPrice = workloadNumber(route.dataset.outputPrice || '0');
    route.dataset.compositePrice = String(inputPrice * inputVolume + outputPrice * outputVolume);
  });

  const minima = {
    all: tableRoutes,
    online: tableRoutes.filter((route) => route.dataset.routeOnline === 'true'),
    stable: tableRoutes.filter((route) => route.dataset.routeStable === 'true'),
  };
  (Object.entries(minima) as Array<[keyof typeof minima, HTMLTableRowElement[]]>).forEach(([tier, routes]) => {
    const target = comparison.querySelector<HTMLElement>(`[data-price-tier="${tier}"]`);
    if (!target) return;
    const values = routes.map((route) => Number(route.dataset.compositePrice)).filter(Number.isFinite);
    target.textContent = values.length ? workloadPriceText(Math.min(...values)) : '—';
  });
}

document.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.matches('[data-workload-input], [data-workload-output]')) return;
  const comparison = target.closest<HTMLElement>('[data-price-comparison]');
  if (comparison) updateWorkload(comparison);
});

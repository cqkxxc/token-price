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

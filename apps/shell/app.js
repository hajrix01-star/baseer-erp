const modules = [
  { id:'command', icon:'⌘', color:'#08744d', ar:'مركز القيادة', en:'Command center', arDescription:'صورة تنفيذية وقرارات اليوم.', enDescription:'Executive view and today’s decisions.', arItems:['النظرة التنفيذية','الأولويات','التنبيهات','موجز النشاط'], enItems:['Executive overview','Priorities','Alerts','Activity brief'] },
  { id:'operations', icon:'◫', color:'#176e9e', ar:'العمليات', en:'Operations', arDescription:'المبيعات والمشتريات والمخزون.', enDescription:'Sales, purchasing, and inventory.', arItems:['نظرة التشغيل','المبيعات','المشتريات','الموردون','المخزون والمستودعات','الطلبات'], enItems:['Operations overview','Sales','Purchasing','Suppliers','Inventory & warehouses','Requests'] },
  { id:'finance', icon:'▣', color:'#a3532e', ar:'المالية والمحاسبة', en:'Finance & accounting', arDescription:'الفواتير والخزائن والمصروفات.', enDescription:'Invoices, treasury, and expenses.', arItems:['نظرة المالية','الفواتير والمدفوعات','الخزائن والبنوك','المصروفات','الالتزامات والقروض','الحسابات والسجل'], enItems:['Finance overview','Invoices & payments','Treasury & banks','Expenses','Liabilities & loans','Accounts & ledger'] },
  { id:'hr', icon:'♙', color:'#bd4778', ar:'الموارد البشرية', en:'Human resources', arDescription:'الموظفون والرواتب والخدمات.', enDescription:'Employees, payroll, and services.', arItems:['نظرة HR','الموظفون','الإجازات والعودة','الرواتب','السلف والخصومات','الإقامات والخدمات'], enItems:['HR overview','Employees','Leave & return','Payroll','Advances & deductions','Residencies & services'] },
  { id:'reports', icon:'▥', color:'#876422', ar:'التقارير', en:'Reports', arDescription:'التقارير والضريبة والطباعة.', enDescription:'Reports, tax, printing.', arItems:['نظرة التقارير','التقارير المالية','التقرير الضريبي','Hajri Tax','الطباعة والتصدير'], enItems:['Reports overview','Financial reports','VAT report','Hajri Tax','Print & export'] },
  { id:'admin', icon:'⚙', color:'#536b63', ar:'الإدارة', en:'Administration', arDescription:'الشركات والمستخدمون والإعدادات.', enDescription:'Companies, users, and settings.', arItems:['نظرة الإدارة','الشركات','المستخدمون','الأدوار والصلاحيات','الهوية والثيم','النسخ الاحتياطي'], enItems:['Administration overview','Companies','Users','Roles & permissions','Identity & theme','Backup'] },
];

const state = { language:'ar', theme:'green', current:'command' };
const overlay = document.querySelector('#modules-overlay');
const grid = document.querySelector('#modules-grid');
const searchInput = document.querySelector('#module-search-input');
const quickEntryDialog = document.querySelector('#quick-entry-dialog');
const localized = (module, suffix='') => module[`${state.language}${suffix}`];

function renderModules(query='') {
  const normal = query.trim().toLowerCase();
  const visible = modules.filter((module) => [module.ar,module.en,module.arDescription,module.enDescription].join(' ').toLowerCase().includes(normal));
  document.querySelector('#module-count').textContent = `${visible.length} / ${modules.length}`;
  grid.replaceChildren(...visible.map((module) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `module-card${state.current === module.id ? ' current' : ''}`;
    card.style.setProperty('--module', module.color);
    card.innerHTML = `<span class="module-icon" aria-hidden="true">${BaseerSectionIcons.renderModule(module.id)}</span><span class="module-copy"><strong>${localized(module)}</strong><span>${localized(module,'Description')}</span></span><span class="module-arrow" aria-hidden="true">←</span>`;
    card.addEventListener('click', () => selectModule(module.id));
    return card;
  }));
}
function renderSidebar(module) {
  document.querySelector('#sidebar-title').textContent = localized(module);
  document.querySelector('#module-navigation').replaceChildren(...localized(module,'Items').map((item,index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `nav-item${index === 0 ? ' active' : ''}`;
    button.innerHTML = `${BaseerSectionIcons.render(module.id,index)}<span>${item}</span>`;
    return button;
  }));
}
function renderPage(module) {
  const isArabic = state.language === 'ar';
  document.querySelector('#page-breadcrumb').textContent = `Baseer ERP / ${localized(module)}`;
  document.querySelector('#page-title').textContent = localized(module,'Items')[0];
  document.querySelector('#page-description').textContent = localized(module,'Description');
  document.querySelector('#hero-title').textContent = isArabic ? `مرحبًا بك في ${localized(module)}` : `Welcome to ${localized(module)}`;
  document.querySelector('#hero-copy').textContent = isArabic ? 'هذه مساحة عمل الموديول. ستُبنى بياناته وعملياته لاحقًا من الخادم فقط.' : 'This is the module workspace. Its data and operations will later be server-owned.';
}
function render() {
  const current = modules.find((module) => module.id === state.current);
  renderModules(searchInput.value);
  renderSidebar(current);
  renderPage(current);
}
function openModules() { overlay.classList.remove('is-hidden'); overlay.setAttribute('aria-hidden','false'); window.setTimeout(() => searchInput.focus(),50); }
function selectModule(id) { state.current = id; overlay.classList.add('is-hidden'); overlay.setAttribute('aria-hidden','true'); searchInput.value = ''; render(); }
function toggleTheme() { BaseerLauncherBackgrounds.toggleMenu(document.querySelector('#theme-toggle')); }
function updateLanguage() {
  document.documentElement.lang = state.language;
  document.documentElement.dir = state.language === 'ar' ? 'rtl' : 'ltr';
  document.querySelector('#language-toggle').textContent = state.language === 'ar' ? 'EN' : 'ع';
  document.querySelectorAll('[data-ar]').forEach((element) => { element.textContent = element.dataset[state.language]; });
  searchInput.placeholder = state.language === 'ar' ? 'ابحث عن موديول…' : 'Search a module…';
  BaseerLauncherBackgrounds.refresh();
  render();
}
document.querySelector('#open-modules').addEventListener('click',openModules);
document.querySelector('#hero-open-modules').addEventListener('click',openModules);
document.querySelector('#back-to-modules').addEventListener('click',openModules);
document.querySelector('#close-modules').addEventListener('click',() => { overlay.classList.add('is-hidden'); overlay.setAttribute('aria-hidden','true'); });
document.querySelector('#language-toggle').addEventListener('click',() => { state.language = state.language === 'ar' ? 'en' : 'ar'; updateLanguage(); });
document.querySelector('#theme-toggle').addEventListener('click',toggleTheme);
document.querySelector('#launcher-theme-toggle').addEventListener('click',() => BaseerLauncherBackgrounds.toggleMenu());
document.querySelector('#quick-entry').addEventListener('click',() => quickEntryDialog.showModal());
searchInput.addEventListener('input',(event) => renderModules(event.target.value));
overlay.addEventListener('click',(event) => { if (event.target === overlay) { overlay.classList.add('is-hidden'); overlay.setAttribute('aria-hidden','true'); } });
document.addEventListener('keydown',(event) => { if (event.key === 'Escape' && !overlay.classList.contains('is-hidden')) { overlay.classList.add('is-hidden'); overlay.setAttribute('aria-hidden','true'); } });
render();

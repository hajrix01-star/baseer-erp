const modules = [
  {id:'command',icon:'⌘',color:'#08744d',title:'مركز القيادة',description:'صورة تنفيذية وقرارات اليوم.',items:['النظرة التنفيذية','الأولويات','التنبيهات','موجز النشاط']},
  {id:'operations',icon:'◫',color:'#176e9e',title:'العمليات',description:'المبيعات والمشتريات والمخزون.',items:['نظرة التشغيل','المبيعات','المشتريات','الموردون','المخزون والمستودعات','الطلبات']},
  {id:'finance',icon:'▣',color:'#a3532e',title:'المالية والمحاسبة',description:'الفواتير والخزائن والمصروفات.',items:['نظرة المالية','الفواتير والمدفوعات','الخزائن والبنوك','المصروفات','الالتزامات والقروض','الحسابات والسجل']},
  {id:'hr',icon:'♙',color:'#bd4778',title:'الموارد البشرية',description:'الموظفون والرواتب والخدمات.',items:['نظرة HR','الموظفون','الإجازات والعودة','الرواتب','السلف والخصومات','الإقامات والخدمات']},
  {id:'reports',icon:'▥',color:'#876422',title:'التقارير',description:'التقارير والضريبة والطباعة.',items:['نظرة التقارير','التقارير المالية','التقرير الضريبي','Hajri Tax','الطباعة والتصدير']},
  {id:'admin',icon:'⚙',color:'#536b63',title:'الإدارة',description:'الشركات والمستخدمون والإعدادات.',items:['نظرة الإدارة','الشركات','المستخدمون','الأدوار والصلاحيات','الهوية والثيم','النسخ الاحتياطي']},
];
const state = {step:'modules',moduleId:'command',sectionIndex:0};
const overlay = document.querySelector('#launcher-overlay');
const grid = document.querySelector('#launcher-grid');
const search = document.querySelector('#launcher-search');
const currentModule = () => modules.find((module) => module.id === state.moduleId);
function openLauncher() { overlay.classList.remove('is-hidden'); search.value=''; renderLauncher(); setTimeout(()=>search.focus(),50); }
function closeLauncher() { overlay.classList.add('is-hidden'); }
function renderLauncher() {
  const module = currentModule(); const query = search.value.trim().toLowerCase(); const isSections = state.step === 'sections';
  document.querySelector('#launcher-kicker').textContent = isSections ? module.title : 'Baseer ERP';
  document.querySelector('#launcher-title').textContent = isSections ? `اختر القسم داخل ${module.title}` : 'اختر الموديول الذي تريد العمل فيه';
  document.querySelector('#launcher-intro').textContent = isSections ? 'بعد الاختيار ستفتح مساحة القسم، وستظهر بقية الأقسام في القائمة الجانبية.' : 'كل الموديولات تشترك في نفس الشركة والبيانات والصلاحيات.';
  document.querySelector('#launcher-note').textContent = isSections ? 'الأقسام ليست تبويبات؛ ستكون في القائمة الجانبية بعد الدخول.' : 'تظهر الموديولات وفق الصلاحيات.';
  document.querySelector('#launcher-back').hidden = !isSections;
  document.querySelector('#launcher-count').textContent = isSections ? `${module.items.length} أقسام` : `${modules.length} / ${modules.length}`;
  search.placeholder = isSections ? 'ابحث عن قسم…' : 'ابحث عن موديول…';
  const choices = isSections ? module.items.map((title,index)=>({title,index})) : modules;
  const visible = choices.filter((item)=> (isSections ? item.title : `${item.title} ${item.description}`).toLowerCase().includes(query));
  grid.replaceChildren(...visible.map((item) => {
    const button = document.createElement('button'); button.type='button';
    if (isSections) { button.className='section-card'; button.style.setProperty('--module',module.color); button.innerHTML=`<span class="section-order">${String(item.index+1).padStart(2,'0')}</span><span><strong>${item.title}</strong><small>فتح القسم</small></span><span class="section-arrow">←</span>`; button.addEventListener('click',()=>chooseSection(item.index)); }
    else { button.className=`module-card${item.id===state.moduleId?' current':''}`; button.style.setProperty('--module',item.color); button.innerHTML=`<span class="module-icon">${item.icon}</span><span class="module-copy"><strong>${item.title}</strong><span>${item.description}</span></span><span class="module-arrow">←</span>`; button.addEventListener('click',()=>chooseModule(item.id)); }
    return button;
  }));
}
function chooseModule(id) { state.moduleId=id; state.step='sections'; search.value=''; renderLauncher(); }
function chooseSection(index) { state.sectionIndex=index; closeLauncher(); renderWorkspace(); }
function renderWorkspace() {
  const module=currentModule(); const section=module.items[state.sectionIndex];
  document.querySelector('#sidebar-title').textContent=module.title; document.querySelector('#crumb').textContent=`Baseer ERP / ${module.title}`; document.querySelector('#page-title').textContent=section; document.querySelector('#page-description').textContent=module.description; document.querySelector('#hero-title').textContent=`مرحبًا بك في ${section}`;
  const nav=document.querySelector('#side-nav'); nav.replaceChildren(...module.items.map((item,index)=>{ const button=document.createElement('button'); button.type='button'; button.className=`nav-item${index===state.sectionIndex?' active':''}`; button.innerHTML=`<span class="nav-dot"></span><span>${item}</span>`; button.addEventListener('click',()=>{state.sectionIndex=index;renderWorkspace();}); return button;}));
}
document.querySelector('#open-launcher').addEventListener('click',openLauncher);document.querySelector('#hero-launcher').addEventListener('click',openLauncher);document.querySelector('#side-launcher').addEventListener('click',openLauncher);document.querySelector('#close-launcher').addEventListener('click',closeLauncher);document.querySelector('#launcher-back').addEventListener('click',()=>{state.step='modules';search.value='';renderLauncher();});search.addEventListener('input',renderLauncher);overlay.addEventListener('click',(event)=>{if(event.target===overlay)closeLauncher();});
renderWorkspace();renderLauncher();

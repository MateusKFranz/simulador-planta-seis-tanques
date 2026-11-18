import './interface-panels.css';

// Move os próprios controles, preservando rascunhos, eventos e validações.
export function setupInterfacePanels() {
    function panel(title, className) {
        const dialog = document.createElement('dialog');
        dialog.className = `interface-panel ${className}`;
        dialog.setAttribute('aria-label', title);
        const header = document.createElement('header');
        const heading = document.createElement('strong');
        heading.textContent = title;
        const close = document.createElement('button');
        close.textContent = '×'; close.setAttribute('aria-label', `Fechar ${title}`);
        close.onclick = () => dialog.close();
        header.append(heading, close); dialog.append(header);
        document.body.append(dialog);
        dialog.addEventListener('keydown', event => { if (event.key === 'Escape') dialog.close(); });
        document.addEventListener('workspace-panel-open', () => dialog.close());
        return dialog;
    }
    document.querySelector('.sidebar .operation-controls').append(document.querySelector('.sidebar-scenario'));
    const automation = panel('Cenários', 'automation-panel');
    for (const node of [document.getElementById('control-scenario')?.parentElement,
        document.querySelector('.op-requirements'), document.getElementById('loop-controls'), document.querySelector('.loop-faceplate'), document.querySelector('.op-times')]) {
        if (node) automation.append(node);
    }


    const settings = panel('Configurações', 'settings-panel');
    const simulation = document.createElement('div');
    simulation.className = 'settings-simulation simulation-only-section';
    const simulationTitle = document.createElement('h2'); simulationTitle.textContent = 'Simulação';
    simulation.append(simulationTitle);
    for (const node of [document.getElementById('simulation-speed')?.closest('label'),
        document.getElementById('initial-level-section'), document.getElementById('capacity-section')]) {
        if (node) simulation.append(node);
    }
    const capacityNote = document.createElement('p');
    capacityNote.className = 'capacity-note';
    capacityNote.textContent = 'Capacidade calculada pelo perfil geométrico da FMU. O modelo atual usa o mesmo perfil nos seis tanques e não permite editar capacidades individuais nesta interface.';
    simulation.querySelector('#capacity-section').append(capacityNote);
    const interfaceTitle = document.createElement('h2'); interfaceTitle.textContent = 'Interface';
    const label = document.createElement('p'); label.textContent = 'Tamanho do texto da interface';
    settings.append(simulation, interfaceTitle, label, document.querySelector('.sidebar-text-control'));
    const button = document.createElement('button');
    button.className = 'settings-open'; button.textContent = '⚙ Configurações';
    button.setAttribute('aria-label', 'Configurações da interface');
    const scenariosButton = document.createElement('button');
    scenariosButton.className = 'scenarios-open';
    scenariosButton.textContent = 'Cenários';
    scenariosButton.onclick = () => automation.show();
    const actions = document.createElement('div');
    actions.className = 'topbar-actions';
    document.querySelector('.topbar').append(actions);
    actions.append(scenariosButton, button);
    button.onclick = () => settings.show();
}

const english = {
  hero: {
    eyebrow: 'Made for independent practices',
    headline: 'Care for the work around care.',
    description:
      'From the first appointment to the final piece of paperwork, CareIQ is being built to help your team keep the details moving—so you can stay focused on the people in front of you.',
    primaryCta: 'Explore CareIQ',
    secondaryCta: 'Talk with us',
    stage: 'In development. Currently for demonstration with synthetic data only.',
  },
  preview: {
    label: 'Illustrative CareIQ practice dashboard',
    practice: 'Evergreen Medical Practice',
    workspace: 'Workspace',
    navigation: ['Today', 'Appointments', 'Patients', 'Documents', 'Insurance'],
    eyebrow: 'Your practice · Today',
    heading: 'A clearer start to the day.',
    description: 'See what needs attention across your team.',
    stats: ['Appointments', 'Ready for visit', 'Needs follow-up'],
    visits: 'Upcoming visits',
    today: 'Today',
    rows: [
      { time: '9:00 AM', name: 'Alex Morgan', visit: 'New patient visit', status: 'Ready' },
      { time: '9:30 AM', name: 'Jamie Lee', visit: 'Follow-up visit', status: 'Paperwork needed' },
      { time: '10:00 AM', name: 'Taylor Reed', visit: 'Office visit', status: 'Ready' },
    ],
    caption: 'Illustrative preview · fictional practice, patients, and records',
  },
  strip: {
    heading: 'One place for the details that keep a practice moving.',
    items: ['Appointments', 'Paperwork', 'Follow-up', 'Team coordination'],
  },
  features: {
    eyebrow: 'The CareIQ workspace',
    heading: 'Less chasing. More clarity.',
    description:
      'CareIQ brings everyday practice tasks together, helping your team see what’s done, what’s next, and where a little attention is needed.',
    cards: [
      {
        title: 'Appointments & availability',
        description:
          'See the schedule, find available times, and keep the details of each visit close at hand.',
      },
      {
        title: 'Patient information',
        description:
          'Find patient profiles, contact details, upcoming visits, and related paperwork in one place.',
      },
      {
        title: 'Forms & paperwork',
        description:
          'Prepare forms, track requests and signatures, and review documents before a visit.',
      },
      {
        title: 'Visit readiness',
        description:
          'See which required forms and documents are ready, and which still need attention.',
      },
      {
        title: 'Insurance follow-up',
        description:
          'Record manual coverage observations, flag questions, and assign follow-up. Automated insurance verification is not available.',
      },
      {
        title: 'Team coordination',
        description:
          'Assign shared work, review staff activity, and keep the next steps visible to the people handling them.',
      },
      {
        title: 'Access & activity review',
        description:
          'Manage appropriate access for your team and review protected activity records with the required permissions.',
      },
    ],
    note: 'These features describe the current development scope. Demonstrations use synthetic data; availability and delivery capabilities are still being evaluated.',
  },
  flow: {
    eyebrow: 'A more connected day',
    heading: 'Every visit has a lot behind it.',
    description:
      'CareIQ is designed to give your team a clearer path through the work that surrounds an appointment.',
    steps: [
      {
        title: 'Start with the schedule',
        description: 'Bring appointments, provider availability, and patient details into view.',
      },
      {
        title: 'Prepare for the visit',
        description:
          'See which forms, documents, and other requirements are ready or still need follow-up.',
      },
      {
        title: 'Keep the team in sync',
        description: 'Assign work, record insurance questions, and see what needs attention next.',
      },
    ],
  },
  teams: {
    eyebrow: 'Built around your team',
    heading: 'Everyone has a part in a better visit.',
    description:
      'Whether you’re welcoming patients, preparing for a visit, or overseeing the practice, the right details should be easy to find.',
    roles: [
      { title: 'For doctors', description: 'Patient details and visit preparation in one view.' },
      {
        title: 'For nurses and medical assistants',
        description: 'A clear view of paperwork and the requirements for the next visit.',
      },
      {
        title: 'For front-desk staff',
        description: 'Appointments, availability, and follow-up close at hand.',
      },
      {
        title: 'For practice managers and owners',
        description: 'Visibility into team activity, access, and outstanding work.',
      },
    ],
    principleLabel: 'Designed with care',
    principle: 'What does the team need to know next?',
    principleDescription:
      'That simple question guides how CareIQ brings information and follow-up together.',
    stageHeading: 'Taking shape, with care.',
    stageDescription:
      'CareIQ is in development and is not ready for live patient care. Demonstrations use synthetic data. Planned integrations and automated insurance verification are not available.',
  },
  cta: {
    heading: 'Let’s make room for better days.',
    description:
      'CareIQ is taking shape with input from people who know practice work best. Tell us what would make a difference for your team.',
    label: 'Share your experience',
    research: 'Learn about our research',
  },
};

export type ProductContent = typeof english;

const spanish: ProductContent = {
  hero: {
    eyebrow: 'Para consultorios independientes',
    headline: 'Cuidamos el trabajo que rodea la atención.',
    description:
      'Desde la primera cita hasta el último formulario, estamos creando CareIQ para ayudar a su equipo a coordinar los detalles y concentrarse en las personas que atiende.',
    primaryCta: 'Explorar CareIQ',
    secondaryCta: 'Conversemos',
    stage: 'En desarrollo. Actualmente solo para demostraciones con datos sintéticos.',
  },
  preview: {
    label: 'Panel ilustrativo de un consultorio en CareIQ',
    practice: 'Consultorio Evergreen',
    workspace: 'Espacio de trabajo',
    navigation: ['Hoy', 'Citas', 'Pacientes', 'Documentos', 'Seguros'],
    eyebrow: 'Su consultorio · Hoy',
    heading: 'Un comienzo del día más claro.',
    description: 'Revise lo que necesita la atención de su equipo.',
    stats: ['Citas', 'Listos para la visita', 'Por dar seguimiento'],
    visits: 'Próximas visitas',
    today: 'Hoy',
    rows: [
      { time: '9:00', name: 'Alex Morgan', visit: 'Primera visita', status: 'Listo' },
      {
        time: '9:30',
        name: 'Jamie Lee',
        visit: 'Visita de seguimiento',
        status: 'Faltan documentos',
      },
      { time: '10:00', name: 'Taylor Reed', visit: 'Consulta', status: 'Listo' },
    ],
    caption: 'Vista ilustrativa · consultorio, pacientes y registros ficticios',
  },
  strip: {
    heading: 'Un lugar para los detalles que mantienen el consultorio en marcha.',
    items: ['Citas', 'Documentación', 'Seguimiento', 'Coordinación del equipo'],
  },
  features: {
    eyebrow: 'El espacio de trabajo de CareIQ',
    heading: 'Menos pendientes. Más claridad.',
    description:
      'CareIQ reúne las tareas diarias del consultorio para que su equipo vea lo que está hecho, lo que sigue y lo que necesita atención.',
    cards: [
      {
        title: 'Citas y disponibilidad',
        description:
          'Revise la agenda, encuentre horarios disponibles y tenga a mano los detalles de cada visita.',
      },
      {
        title: 'Información del paciente',
        description:
          'Encuentre perfiles, datos de contacto, próximas visitas y documentación relacionada en un solo lugar.',
      },
      {
        title: 'Formularios y documentación',
        description:
          'Prepare formularios, dé seguimiento a solicitudes y firmas, y revise documentos antes de una visita.',
      },
      {
        title: 'Preparación para la visita',
        description:
          'Consulte qué formularios y documentos requeridos están listos y cuáles necesitan atención.',
      },
      {
        title: 'Seguimiento de seguros',
        description:
          'Registre observaciones manuales de cobertura, señale dudas y asigne el seguimiento. La verificación automática de seguros no está disponible.',
      },
      {
        title: 'Coordinación del equipo',
        description:
          'Asigne tareas compartidas, revise la actividad del personal y mantenga los próximos pasos a la vista de quienes los realizan.',
      },
      {
        title: 'Acceso y revisión de actividad',
        description:
          'Administre el acceso adecuado para su equipo y revise registros de actividad protegidos con los permisos necesarios.',
      },
    ],
    note: 'Estas funciones describen el alcance actual del desarrollo. Las demostraciones usan datos sintéticos; la disponibilidad y las capacidades de envío siguen en evaluación.',
  },
  flow: {
    eyebrow: 'Un día mejor coordinado',
    heading: 'Detrás de cada visita hay mucho trabajo.',
    description:
      'CareIQ está diseñado para que su equipo tenga un camino más claro en el trabajo que rodea cada cita.',
    steps: [
      {
        title: 'Comience con la agenda',
        description:
          'Reúna las citas, la disponibilidad de los profesionales y los datos del paciente.',
      },
      {
        title: 'Prepare la visita',
        description:
          'Consulte qué formularios, documentos y otros requisitos están listos o necesitan seguimiento.',
      },
      {
        title: 'Mantenga al equipo coordinado',
        description:
          'Asigne tareas, registre dudas sobre seguros y revise lo que necesita atención.',
      },
    ],
  },
  teams: {
    eyebrow: 'Pensado para su equipo',
    heading: 'Todos contribuyen a una mejor visita.',
    description:
      'Ya sea al recibir pacientes, preparar una visita o dirigir el consultorio, los detalles importantes deben ser fáciles de encontrar.',
    roles: [
      {
        title: 'Para médicos',
        description: 'Datos del paciente y preparación de la visita en una misma vista.',
      },
      {
        title: 'Para enfermeros y asistentes médicos',
        description: 'Una vista clara de la documentación y los requisitos de la próxima visita.',
      },
      {
        title: 'Para el personal de recepción',
        description: 'Citas, disponibilidad y seguimiento a mano.',
      },
      {
        title: 'Para administradores y propietarios',
        description: 'Visibilidad de la actividad del equipo, el acceso y las tareas pendientes.',
      },
    ],
    principleLabel: 'Diseñado con cuidado',
    principle: '¿Qué necesita saber el equipo ahora?',
    principleDescription:
      'Esta sencilla pregunta guía cómo CareIQ reúne la información y el seguimiento.',
    stageHeading: 'En desarrollo, con cuidado.',
    stageDescription:
      'CareIQ está en desarrollo y no está listo para atender a pacientes reales. Las demostraciones usan datos sintéticos. Las integraciones previstas y la verificación automática de seguros no están disponibles.',
  },
  cta: {
    heading: 'Hagamos espacio para mejores días.',
    description:
      'CareIQ está tomando forma con las ideas de quienes mejor conocen el trabajo del consultorio. Cuéntenos qué ayudaría a su equipo.',
    label: 'Comparta su experiencia',
    research: 'Conozca nuestra investigación',
  },
};

export const productContent = { en: english, es: spanish };

import { caminho } from "@/lib/caminho";

/**
 * Contrato de conteúdo da Blue Magnitude.
 *
 * Tudo o que é do cliente vive aqui. Nenhum componente escreve texto de marca,
 * números ou contactos directamente. Todo o texto foi recolhido de
 * bluemagnitude.pt na auditoria de 26/8/2026. Nada aqui é inventado: o que
 * falta está em docs/PERGUNTAS-AO-CLIENTE.md e não no ecrã.
 */

export const EMPRESA = {
  nome: "Blue Magnitude",
  claim: "Fazemos circular energia",
  promessa: "Transformamos luz em poupança",
  morada: "Estr. de Pinheiros 480, 2415-776 Leiria",
  maps: "https://maps.app.goo.gl/fLNxwuEpM34Wbnes9",
  telefone: "+351 244 046 081",
  telefoneNota: "Chamadas para a rede fixa nacional",
  whatsapp: "351938719773",
  email: "geral@bluemagnitude.pt",
  horario: "Segunda a sexta, das 9h às 18h",
  zonas: "Leiria, Santarém e Lisboa",
  instagram: "https://www.instagram.com/bluemagnitude/",
  instagramHandle: "@bluemagnitude",
  facebook:
    "https://www.facebook.com/people/Blue-Magnitude-Instala%C3%A7%C3%B5es-fotovoltaicas/61559853587171/",
} as const;

export const HERO = {
  credito: "Instalações fotovoltaicas",
  titulo: "Energia solar para empresas",
  tituloDestaque: "que querem pagar menos luz",
  lede:
    "Criamos soluções de energia solar feitas à medida para o teu negócio. Reduz a tua fatura de eletricidade e junta-te às empresas que já se ligaram ao sol connosco.",
  primario: "Pedir proposta",
  secundario: "Ver instalações",
  videoAlt:
    "Vista aérea da equipa da Blue Magnitude a montar painéis solares no telhado de um armazém ao fim da tarde.",
} as const;

export const QUEM_SOMOS = {
  credito: "Quem somos",
  titulo: "Estamos a construir um mundo mais sustentável",
  paragrafos: [
    "Na Blue Magnitude dedicamo-nos a soluções no setor das energias renováveis e a aumentar a eficiência energética em Portugal. A nossa missão é transformar a maneira como as pessoas e as empresas consomem energia.",
    "Com uma equipa experiente, combinamos conhecimento técnico com uma compreensão real das necessidades do mercado. Estamos comprometidos em liderar a transição energética em Portugal, dando aos nossos clientes as ferramentas e o suporte para reduzir a pegada de carbono e ganhar independência energética.",
  ],
  pilares: [
    "Instalação, manutenção e monitorização feitas pela mesma equipa",
    "Operações em Leiria, Santarém e Lisboa",
    "Engenheiros, técnicos e gestores no mesmo projeto",
    "Rigorosos padrões de qualidade e segurança",
  ],
  imagem: caminho("/projetos/paineis-solares2.jpg"),
  imagemAlt: "Painéis solares instalados num telhado, vistos de baixo.",
} as const;

export type Servico = {
  slug: string;
  nome: string;
  resumo: string;
  credito: string;
  titulo: string;
  intro: string;
  imagem: string;
  imagemAlt: string;
  listaTitulo: string;
  lista: ReadonlyArray<{ titulo: string; texto?: string }>;
  extraTitulo?: string;
  extra?: ReadonlyArray<{ titulo: string; texto?: string }>;
};

export const SERVICOS: ReadonlyArray<Servico> = [
  {
    slug: "autoconsumo",
    nome: "Autoconsumo",
    resumo:
      "Produz e consome a tua própria energia. O excedente vai para a rede ou é vendido a um comercializador.",
    credito: "Autoconsumo",
    titulo: "Sistemas de autoconsumo",
    intro:
      "O autoconsumo com painéis solares fotovoltaicos permite que produzas e consumas parte da **tua própria energia**. Este método aproveita a energia solar para gerar eletricidade **limpa, sustentável e gratuita**. Quando dimensionado de acordo com o perfil de consumo, o sistema oferece maior eficiência. Havendo excedente de produção, a energia extra pode ser **injetada na rede elétrica ou vendida** mediante contrato com um comercializador.",
    imagem: caminho("/projetos/telhado1.jpg"),
    imagemAlt: "Painéis solares montados no telhado de uma moradia.",
    listaTitulo: "O que ganhas",
    lista: [
      { titulo: "Poupa na tua fatura de eletricidade" },
      { titulo: "Desfruta de uma fonte de energia renovável" },
      { titulo: "Beneficia dos incentivos públicos" },
      { titulo: "Aumenta o valor comercial da tua propriedade" },
    ],
    extraTitulo: "Planeamento",
    extra: [
      { titulo: "Proposta gratuita" },
      { titulo: "Aconselhamento personalizado" },
      { titulo: "Aceitação da proposta" },
      { titulo: "Visita técnica" },
      { titulo: "Planeamento" },
      { titulo: "Instalação e legalização" },
    ],
  },
  {
    slug: "autoconsumo-com-baterias",
    nome: "Autoconsumo com baterias",
    resumo:
      "Guarda a energia produzida de dia para a usar de noite ou em dias sem sol.",
    credito: "Autoconsumo",
    titulo: "Sistemas de autoconsumo com baterias",
    intro:
      "Os sistemas de autoconsumo com baterias permitem **armazenar a energia solar excedente** produzida durante o dia para ser utilizada quando a produção solar é baixa ou inexistente. Isso garante **maior independência energética** e uma **redução significativa na fatura elétrica**. A Blue Magnitude oferece soluções personalizadas que incluem a instalação de painéis solares, baterias de alta capacidade e sistemas de gestão de energia, otimizando o uso e o armazenamento da eletricidade gerada.",
    imagem: caminho("/projetos/ECS-banner.jpg"),
    imagemAlt: "Bateria de armazenamento de energia instalada numa parede.",
    listaTitulo: "O que ganhas",
    lista: [
      { titulo: "Armazenamento" },
      { titulo: "Maior independência" },
      { titulo: "Poupança" },
      { titulo: "Maior fiabilidade" },
      { titulo: "Redução das emissões" },
    ],
  },
  {
    slug: "avac-e-climatizacao",
    nome: "AVAC e climatização",
    resumo:
      "Desenho, instalação e manutenção preventiva de sistemas de climatização.",
    credito: "AVAC",
    titulo: "AVAC e climatização",
    intro:
      "A Blue Magnitude oferece **soluções completas de AVAC e climatização** para garantir o **conforto e a eficiência energética** dos teus espaços. Os nossos serviços incluem desenho personalizado, instalação de equipamentos modernos, **manutenção preventiva** e otimização de sistemas existentes. Com uma equipa qualificada, proporcionamos ambientes agradáveis e eficientes, adaptados às tuas necessidades, seja para residências ou instalações comerciais.",
    imagem: caminho("/projetos/ar-condicionado.jpg"),
    imagemAlt: "Unidade de ar condicionado instalada numa parede interior.",
    listaTitulo: "Vantagens de instalar um sistema AVAC",
    lista: [
      { titulo: "Purificação do ar" },
      { titulo: "Aumento de conforto" },
      { titulo: "Poupança" },
      { titulo: "Multifuncionalidade" },
      { titulo: "Impacto ambiental" },
    ],
    extraTitulo: "Porque deve investir na manutenção",
    extra: [
      { titulo: "Aumento da longevidade dos equipamentos instalados" },
      { titulo: "Adiar ou evitar custos na substituição de componentes" },
      { titulo: "Aumento da rentabilidade dos equipamentos instalados" },
    ],
  },
  {
    slug: "manutencao",
    nome: "Manutenção",
    resumo:
      "Inspeção, limpeza, testes de performance e substituição de componentes desgastados.",
    credito: "Manutenção",
    titulo: "Manter os sistemas solares em perfeito estado",
    intro:
      "Manter os teus sistemas de energia solar e climatização em perfeito estado é essencial para garantir a sua **eficiência e durabilidade**. Na Blue Magnitude oferecemos serviços completos de manutenção, incluindo **inspeção, limpeza, testes de performance** e substituição de componentes desgastados. A nossa equipa técnica assegura que os teus sistemas operem com máxima eficiência, **prolongando a vida útil** e otimizando a produção de energia.",
    imagem: caminho("/projetos/solar-panels-2048x1365.jpg"),
    imagemAlt: "Fila de painéis solares limpos ao sol.",
    listaTitulo: "Benefícios",
    lista: [
      { titulo: "Aumento da eficiência energética" },
      { titulo: "Redução dos custos de energia elétrica" },
      { titulo: "Maximiza a vida útil do sistema" },
      { titulo: "Melhora da aparência" },
      { titulo: "Garantia do bom funcionamento do sistema" },
    ],
  },
  {
    slug: "sistemas-off-grid",
    nome: "Sistemas off-grid",
    resumo:
      "Independência total para locais remotos ou com acesso limitado à rede elétrica.",
    credito: "Off-grid",
    titulo: "Sistemas off-grid",
    intro:
      "Para locais remotos ou com acesso limitado à rede elétrica, os sistemas off-grid da Blue Magnitude oferecem **total independência energética**. Utilizando painéis solares e baterias, estes sistemas garantem uma fonte de energia **fiável e contínua**, ideal para áreas rurais, montanhas, ilhas e outros locais isolados.",
    imagem: caminho("/projetos/off-grid4-1.jpg"),
    imagemAlt: "Painéis solares isolados numa zona rural.",
    listaTitulo: "Vantagens",
    lista: [
      {
        titulo: "Autonomia energética",
        texto:
          "Produz e armazena a tua própria energia, eliminando a dependência da rede elétrica.",
      },
      {
        titulo: "Sustentabilidade",
        texto: "Usa energia renovável, reduzindo a pegada ecológica.",
      },
      {
        titulo: "Fiabilidade",
        texto:
          "Sistema desenhado para funcionar em todas as condições, assegurando fornecimento constante.",
      },
    ],
    extraTitulo: "Componentes do sistema",
    extra: [
      {
        titulo: "Painéis solares",
        texto: "Capturam a energia do sol para gerar eletricidade.",
      },
      {
        titulo: "Baterias",
        texto:
          "Armazenam a energia excedente para uso posterior, garantindo fornecimento mesmo durante a noite ou em dias nublados.",
      },
      {
        titulo: "Inversores",
        texto:
          "Convertem a corrente contínua gerada pelos painéis em corrente alternada, utilizada pelos aparelhos elétricos.",
      },
      {
        titulo: "Controladores de carga",
        texto:
          "Regulam a carga e a descarga das baterias, aumentando a vida útil e a eficiência.",
      },
    ],
  },
  {
    slug: "consultoria",
    nome: "Consultoria",
    resumo:
      "Avaliação, dimensionamento e acompanhamento técnico do projeto fotovoltaico.",
    credito: "Consultoria",
    titulo: "Consultoria de sistemas fotovoltaicos",
    intro:
      "A transição para as energias renováveis nunca foi tão importante, e a energia solar está na vanguarda desta mudança. A nossa consultoria em sistemas fotovoltaicos guia a tua empresa **em cada etapa do processo**, garantindo uma transição **eficiente, económica e sustentável** para a energia solar.",
    imagem: caminho("/projetos/projetar.jpg"),
    imagemAlt: "Projeto técnico de instalação fotovoltaica sobre uma mesa.",
    listaTitulo: "O que fazemos",
    lista: [
      {
        titulo: "Avaliação e consultoria",
        texto:
          "Analisamos as tuas necessidades energéticas e as características do local para oferecer a melhor solução.",
      },
      {
        titulo: "Dimensionamento personalizado",
        texto:
          "Projetamos sistemas adaptados a cada cliente, considerando a energia necessária e as condições climáticas locais.",
      },
      {
        titulo: "Instalação completa",
        texto:
          "A nossa equipa cuida de todo o processo, garantindo a correta integração dos painéis, baterias e restantes componentes.",
      },
      {
        titulo: "Manutenção e suporte técnico",
        texto:
          "Manutenção regular e suporte contínuo para assegurar a eficiência e a durabilidade do sistema.",
      },
    ],
  },
];

export type Projeto = {
  slug: string;
  titulo: string;
  categoria: "Autoconsumo" | "Autoconsumo com baterias";
  local: string;
  potencia: number;
  paineis: string;
  inversor: string;
  bateria: string | null;
  resumoCurto: string;
  /**
   * ⚠️ UMA FRASE, NAO TRES PARAGRAFOS. Os originais tinham ~1000 caracteres
   * cada, repetiam a ficha tecnica e eram quase iguais entre projetos. O que
   * ficou e o essencial, e o que importa vai marcado com ** ** para o
   * TextoRealcado o destacar.
   */
  resumo: string;
  imagem: string;
  imagemAlt: string;
};

export const PROJETOS: ReadonlyArray<Projeto> = [
  {
    slug: "autoconsumo-acumulacao-12100w-leiria",
    titulo: "Instalação autoconsumo com acumulação 12100 W",
    categoria: "Autoconsumo com baterias",
    local: "Leiria",
    potencia: 12100,
    paineis: "AIKO 605 W, 20 unidades",
    inversor: "Fox ESS H3-Pro 20.0",
    bateria: "Fox ESS Energy Cube 2900, 11,6 kW",
    resumoCurto:
      "Uma solução completa e robusta, projetada para garantir eficiência e sustentabilidade a longo prazo.",
    resumo:
      "Vinte painéis **Aiko de 605 W** ligados a um inversor Fox ESS H3-Pro, com **11,6 kW de bateria** a guardar o que sobra do dia. A casa fica com energia própria à noite e em dias nublados, sem depender da rede para o consumo de base.",
    imagem: caminho("/projetos/DJI_0125-scaled.jpg"),
    imagemAlt:
      "Vista aérea de um telhado com vinte painéis solares instalados em Leiria.",
  },
  {
    slug: "autoconsumo-acumulacao-3150w-mata-mourisca",
    titulo: "Instalação autoconsumo com acumulação 3150 W",
    categoria: "Autoconsumo com baterias",
    local: "Mata Mourisca",
    potencia: 3150,
    paineis: "AIKO 450 W, 7 unidades",
    inversor: "Solplanet ASW4000H",
    bateria: "Sunwoda Monawall, 5,12 kW",
    resumoCurto:
      "Um projeto desenvolvido para fornecer uma solução de energia limpa e eficiente.",
    resumo:
      "Sete painéis **Aiko de 450 W** com inversor Solplanet e uma bateria **Sunwoda Monawall de 5,12 kW**. O excedente do meio do dia fica guardado e é ele que alimenta a casa ao fim da tarde, que é quando a fatura costuma pesar.",
    imagem: caminho("/projetos/Mata-Mourisca5-scaled.jpg"),
    imagemAlt:
      "Vista aérea de sete painéis solares instalados num telhado em Mata Mourisca.",
  },
  {
    slug: "autoconsumo-acumulacao-2250w-penela",
    titulo: "Instalação autoconsumo com acumulação 2250 W",
    categoria: "Autoconsumo com baterias",
    local: "Penela",
    potencia: 2250,
    paineis: "AIKO 450 W, 5 unidades",
    inversor: "Solplanet ASW4000H",
    bateria: "Sunwoda Monawall, 5,12 kW",
    resumoCurto:
      "Uma solução energética integrada, focada em autonomia e eficiência.",
    resumo:
      "Cinco painéis **Aiko de 450 W**, inversor Solplanet e **5,12 kW de armazenamento**. Um sistema pequeno e fechado sobre si mesmo: produz, guarda, e devolve à noite o que não foi preciso de dia.",
    imagem: caminho("/projetos/DJI_0101-scaled.jpg"),
    imagemAlt:
      "Vista aérea de cinco painéis solares instalados num telhado em Penela.",
  },
  {
    slug: "autoconsumo-2700w-serra-santo-antonio",
    titulo: "Instalação autoconsumo 2700 W",
    categoria: "Autoconsumo",
    local: "Serra de Santo António",
    potencia: 2700,
    paineis: "AIKO 450 W, 6 unidades",
    inversor: "Fox ESS S-3000",
    bateria: null,
    resumoCurto:
      "Uma solução robusta e sustentável, com energia limpa de forma eficiente.",
    resumo:
      "Seis painéis **Aiko de 450 W** com inversor Fox ESS S-3000, em autoconsumo directo. **Sem baterias**: toda a energia produzida é gasta na hora, que é a forma mais barata de baixar a fatura quando o consumo acontece de dia.",
    imagem: caminho("/projetos/Serra-Santo-Antonio2-scaled.jpg"),
    imagemAlt:
      "Vista aérea de seis painéis solares instalados na Serra de Santo António.",
  },
  {
    slug: "autoconsumo-2700w-vila-nova-da-barquinha",
    titulo: "Instalação autoconsumo 2700 W",
    categoria: "Autoconsumo",
    local: "Vila Nova da Barquinha",
    potencia: 2700,
    paineis: "AIKO 450 W, 6 unidades",
    inversor: "Fox ESS S-3000",
    bateria: null,
    resumoCurto:
      "Uma solução energética eficaz, alinhada com a redução do impacto ambiental.",
    resumo:
      "Seis painéis **Aiko de 450 W** e inversor Fox ESS S-3000, também em autoconsumo directo. **Sem baterias**, com a produção a entrar directamente no consumo da casa durante as horas de sol.",
    imagem: caminho("/projetos/DJI_0134-scaled.jpg"),
    imagemAlt:
      "Vista aérea de seis painéis solares instalados em Vila Nova da Barquinha.",
  },
];

export const PROCESSO = {
  credito: "Como trabalhamos",
  titulo: "Do primeiro contacto até à legalização",
  lede:
    "Implementamos práticas que promovem a eficiência energética e a responsabilidade ambiental e social.",
  passos: [
    {
      titulo: "Proposta gratuita",
      texto: "Elaboramos uma proposta completamente gratuita.",
    },
    {
      titulo: "Aceitação da proposta",
      texto: "Após a proposta aguardamos pela aceitação da mesma.",
    },
    {
      titulo: "Planeamento",
      texto: "Planeamos toda a instalação com base na proposta.",
    },
    {
      titulo: "Instalação e legalização",
      texto: "Instalamos o sistema e por fim tratamos da legalização.",
    },
  ],
} as const;

export const PERGUNTAS = {
  credito: "Perguntas",
  titulo: "O que nos costumam perguntar",
  itens: [
    {
      q: "O que é o autoconsumo",
      r: "É produzires e consumires parte da tua própria energia com painéis solares fotovoltaicos. Quando o sistema é dimensionado de acordo com o teu perfil de consumo, o aproveitamento é maior. Se houver excedente, essa energia pode ser injetada na rede elétrica ou vendida mediante contrato com um comercializador.",
    },
    {
      q: "Preciso de baterias",
      r: "Não é obrigatório. Sem baterias o sistema trabalha em sinergia com a rede, usando o sol durante o dia e a rede quando faz falta. Com baterias, o excedente produzido de dia fica guardado para a noite ou para dias nublados, o que aumenta a independência energética. Dos cinco projetos que mostramos aqui, três levaram bateria e dois não.",
    },
    {
      q: "E se o local não tiver rede elétrica",
      r: "Para locais remotos ou com acesso limitado à rede existem os sistemas off-grid, que funcionam com painéis e baterias e garantem fornecimento contínuo. São a solução habitual em zonas rurais, montanha, ilhas, abrigos e infraestruturas agrícolas.",
    },
    {
      q: "Tratam da legalização",
      r: "Sim. A legalização é o último passo do nosso processo, depois da instalação. Antes disso há proposta gratuita, aconselhamento, aceitação da proposta, visita técnica e planeamento.",
    },
    {
      q: "Fazem manutenção depois da instalação",
      r: "Fazemos. Inspeção, limpeza, testes de performance e substituição de componentes desgastados, tanto nos sistemas solares como nos de climatização. É o que mantém a produção no nível para que o sistema foi dimensionado.",
    },
    {
      q: "Onde trabalham",
      r: "Temos operações em Leiria, Santarém e Lisboa, e a sede fica na Estrada de Pinheiros 480, em Leiria.",
    },
    {
      q: "Quanto custa",
      r: "Depende do consumo, do local e do equipamento. A proposta é gratuita e sem compromisso: dizes-nos o que precisas, fazemos as contas e apresentamos os números antes de haver qualquer decisão.",
    },
  ],
} as const;

export const CONTACTO = {
  credito: "Falar connosco",
  titulo: "Pede a tua proposta gratuita",
  lede:
    "Instalação de sistemas fotovoltaicos, manutenção, monitorização e consultoria. Equipa qualificada e atendimento personalizado.",
  garantias: [
    "Proposta gratuita e sem compromisso",
    "Visita técnica antes de qualquer instalação",
    "Instalação e legalização tratadas por nós",
    "Manutenção e suporte depois da entrega",
  ],
  distritos: [
    "Aveiro", "Beja", "Braga", "Bragança", "Castelo Branco", "Coimbra",
    "Évora", "Faro", "Guarda", "Leiria", "Lisboa", "Portalegre", "Porto",
    "Santarém", "Setúbal", "Viana do Castelo", "Vila Real", "Viseu",
  ],
  tipos: [
    "Instalação fotovoltaica",
    "AVAC e climatização",
    "Manutenção",
    "Consultoria",
  ],
} as const;

export const PRIVACIDADE = {
  titulo: "Política de privacidade",
  intro:
    "A Blue Magnitude valoriza a sua privacidade e compromete-se a proteger os dados pessoais de todos os utilizadores e clientes. Esta política explica como recolhemos, utilizamos, armazenamos e partilhamos os seus dados pessoais quando utiliza os nossos serviços e interage com a nossa empresa, de acordo com as disposições do Regulamento Geral de Proteção de Dados e outra legislação aplicável.",
  seccoes: [
    {
      titulo: "1. Recolha de informações pessoais",
      paragrafos: [
        "Recolhemos informações pessoais quando preenche formulários no nosso site, contrata um dos nossos serviços, entra em contacto connosco por email, telefone ou outros meios de comunicação, ou participa em inquéritos, promoções e eventos.",
        "As informações que podemos recolher incluem nome completo, endereço de email, número de telefone, endereço postal, informações de pagamento quando aplicável e dados de navegação, como cookies e endereços IP.",
      ],
    },
    {
      titulo: "2. Utilização de informações pessoais",
      paragrafos: [
        "Utilizamos os seus dados pessoais para processar as suas solicitações, enviar atualizações sobre produtos, serviços e ofertas especiais, melhorar a experiência no nosso site, personalizar o conteúdo de acordo com os seus interesses e cumprir obrigações legais e regulamentares.",
      ],
    },
    {
      titulo: "3. Partilha de informações",
      paragrafos: [
        "A Blue Magnitude não vende, aluga nem partilha os seus dados pessoais com terceiros, excepto para cumprir exigências legais ou regulamentares, com parceiros ou prestadores de serviços que nos ajudam a operar o site ou a fornecer os nossos serviços, sempre sob confidencialidade estrita, e em caso de fusão, aquisição ou venda de ativos, situação em que será previamente notificado.",
      ],
    },
    {
      titulo: "4. Cookies e tecnologias de rastreamento",
      paragrafos: [
        "O nosso site utiliza cookies e outras tecnologias para melhorar a sua experiência de navegação. Cookies são pequenos ficheiros de texto armazenados no seu dispositivo. Usamo-los para reconhecer o seu dispositivo em futuras visitas, personalizar o conteúdo de acordo com as suas preferências e recolher estatísticas sobre o uso do site.",
        "Pode controlar o uso de cookies através das configurações do seu navegador. Desativá-los pode afetar a funcionalidade de algumas áreas do site.",
      ],
    },
    {
      titulo: "5. Armazenamento e segurança dos dados",
      paragrafos: [
        "Adotamos medidas técnicas e organizacionais adequadas para proteger os seus dados pessoais contra perda, roubo, uso indevido e acesso não autorizado. Nenhum sistema de segurança é totalmente seguro, pelo que não podemos garantir a segurança absoluta das informações.",
        "Os seus dados serão mantidos durante o tempo necessário para cumprir os propósitos para que foram recolhidos ou para cumprir obrigações legais, a menos que nos seja solicitado o contrário.",
      ],
    },
    {
      titulo: "6. Os seus direitos",
      paragrafos: [
        "Tem o direito de solicitar acesso aos seus dados pessoais, pedir a correção de dados incorretos ou incompletos, solicitar a eliminação dos seus dados quando aplicável, solicitar a portabilidade dos dados para outro fornecedor e retirar o seu consentimento a qualquer momento.",
        "Para exercer os seus direitos, contacte-nos através do email geral@bluemagnitude.pt.",
      ],
    },
    {
      titulo: "7. Alterações a esta política",
      paragrafos: [
        "Reservamo-nos o direito de modificar esta política a qualquer momento. Notificaremos sobre alterações significativas publicando a nova política no nosso site com a data de atualização. Recomendamos que reveja esta página regularmente.",
      ],
    },
    {
      titulo: "8. Contacto",
      paragrafos: [
        "Se tiver dúvidas ou preocupações sobre esta política ou sobre o tratamento dos seus dados pessoais, contacte-nos através do email geral@bluemagnitude.pt.",
      ],
    },
  ],
} as const;

export const SOBRE = {
  credito: "Sobre nós",
  titulo: "Fazemos circular energia positiva",
  blocos: [
    {
      titulo: "Missão",
      icone: "alvo",
      subtitulo: "Soluções energéticas",
      texto:
        "Desde a nossa fundação, trabalhamos para proporcionar soluções energéticas que respondam às necessidades atuais e contribuam para um futuro mais sustentável. Utilizamos tecnologias avançadas para garantir a máxima eficiência e economia.",
    },
    {
      titulo: "Visão",
      icone: "olho",
      subtitulo: "Referência no setor das energias renováveis",
      texto:
        "A Blue Magnitude pretende ser uma referência no setor das energias renováveis, liderando a transição para um uso mais responsável e sustentável da energia. Acreditamos que é possível garantir o bem-estar das futuras gerações através da energia limpa.",
    },
    {
      titulo: "A nossa equipa",
      icone: "equipa",
      subtitulo: "Profissionais altamente qualificados",
      texto:
        "Engenheiros, técnicos e gestores no mesmo projeto, com operações em Leiria, Santarém e Lisboa.",
    },
    {
      titulo: "Sustentabilidade",
      icone: "folha",
      subtitulo: "Responsabilidade ambiental e social",
      texto:
        "Práticas que promovem a eficiência energética e a responsabilidade ambiental e social.",
    },
  ],
  qualidade: {
    titulo: "Rigorosos padrões de qualidade e segurança",
    itens: [
      {
        titulo: "Normas e regulamentos",
        texto: "Cumprimento de todas as normas e regulamentos aplicáveis.",
      },
      {
        titulo: "Expectativas dos clientes",
        texto: "Oferecer soluções que superem as expectativas dos clientes.",
      },
      {
        titulo: "Eficiência e qualidade",
        texto:
          "Colaborar com fornecedores e parceiros para assegurar a eficiência e a qualidade dos nossos serviços.",
      },
      {
        titulo: "Ambiente de trabalho",
        texto: "Garantir um ambiente de trabalho seguro e saudável.",
      },
    ],
  },
  imagens: [
    { src: caminho("/projetos/paineis-solares5-scaled.jpg"), alt: "Painéis solares ao sol." },
    { src: caminho("/projetos/instalacao-autoconsumo.jpg"), alt: "Instalação de autoconsumo em curso." },
  ],
} as const;

/** O arranque da pagina Sobre: o claim deles como titulo, e numeros
    verificaveis. Nada de historia inventada. */
export const ARRANQUE = {
  credito: "Sobre nós",
  titulo: "Fazemos circular energia",
  /**
   * ⚠️ TRES NUMEROS, NAO QUATRO. Saiu "05 instalações documentadas": em fila
   * de tres o telemovel le-os todos de uma vez, e um "05" ao lado de
   * "12 100 W" dizia sobretudo que ha pouca obra mostrada.
   */
  numeros: [
    { valor: "12 100 W", rotulo: "o maior sistema instalado" },
    { valor: "3", rotulo: "distritos onde operamos" },
    { valor: "6", rotulo: "serviços no catálogo" },
  ],
} as const;

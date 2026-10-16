"use client";

import * as React from "react";
import { CONTACTO, EMPRESA } from "@/content/site";

/**
 * O pedido de proposta, em TRES PASSOS.
 *
 * ⚠️ PORQUE E QUE SAO PASSOS E NAO UM FORMULARIO INTEIRO: a versao anterior
 * punha seis campos de uma vez numa chapa, e num telemovel isso e um ecra
 * cheio de caixas vazias antes de se perceber o que esta a ser perguntado.
 * Em tres passos cada ecra faz UMA pergunta ("o que precisas", "quem es",
 * "queres dizer mais alguma coisa") e a barra diz quanto falta.
 *
 * ⚠️ NAO HA BACKEND, e continua a nao haver: no fim abre-se a conversa de
 * WhatsApp ja escrita, que e o canal real destes clientes. Se o browser
 * bloquear a janela, o ecra final mostra o mesmo link e deixa copiar o texto.
 * Nada fica guardado neste site, e esta escrito no ecra.
 *
 * ⚠️ A VALIDACAO E POR PASSO E CORRE AO CARREGAR EM "SEGUINTE", com o foco a
 * saltar para o primeiro campo que falta. O botao nunca fica desactivado: um
 * botao morto nao diz o que falta, e a mensagem diz.
 */

type Campo = "tipo" | "distrito" | "nome" | "telefone" | "email" | "nota";
type Valores = Record<Campo, string>;

const VAZIO: Valores = {
  tipo: "",
  distrito: "",
  nome: "",
  telefone: "",
  email: "",
  nota: "",
};

const PASSOS = [
  { rotulo: "O pedido", campos: ["tipo", "distrito"] as Campo[] },
  { rotulo: "Contacto", campos: ["nome", "telefone", "email"] as Campo[] },
  { rotulo: "Detalhes", campos: ["nota"] as Campo[] },
];

function validar(passo: number, v: Valores) {
  const erros: Partial<Record<Campo, string>> = {};

  if (passo === 0) {
    if (!v.tipo) erros.tipo = "Escolhe o serviço que precisas.";
    if (!v.distrito) erros.distrito = "Escolhe o distrito onde é a instalação.";
  }

  if (passo === 1) {
    if (v.nome.trim().length < 2) erros.nome = "Escreve o teu nome.";
    const digitos = v.telefone.replace(/\D/g, "");
    if (digitos.length < 9) {
      erros.telefone = "O número parece incompleto. Confirma, por favor.";
    }
    // o email e opcional, mas se estiver escrito tem de ser um email
    if (v.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) {
      erros.email = "Esse email não parece estar completo.";
    }
  }

  return erros;
}

function mensagem(v: Valores) {
  const linhas = [
    `Olá, sou ${v.nome.trim()}.`,
    "",
    `Serviço: ${v.tipo}`,
    `Distrito: ${v.distrito}`,
    `Telefone: ${v.telefone.trim()}`,
  ];
  if (v.email.trim()) linhas.push(`Email: ${v.email.trim()}`);
  if (v.nota.trim()) linhas.push("", v.nota.trim());
  return linhas.join("\n");
}

export function ContactoForm() {
  const [passo, setPasso] = React.useState(0);
  const [valores, setValores] = React.useState<Valores>(VAZIO);
  const [erros, setErros] = React.useState<Partial<Record<Campo, string>>>({});
  const [enviado, setEnviado] = React.useState<string | null>(null);
  const [copiado, setCopiado] = React.useState(false);
  const refs = React.useRef<Partial<Record<Campo, HTMLElement | null>>>({});

  const escrever = (campo: Campo) => (valor: string) => {
    setValores((antes) => ({ ...antes, [campo]: valor }));
    // o erro de um campo desaparece assim que se lhe toca
    setErros((antes) => {
      if (!antes[campo]) return antes;
      const seguinte = { ...antes };
      delete seguinte[campo];
      return seguinte;
    });
  };

  function avancar() {
    const encontrados = validar(passo, valores);
    setErros(encontrados);
    const primeiro = PASSOS[passo].campos.find((c) => encontrados[c]);
    if (primeiro) {
      refs.current[primeiro]?.focus();
      return;
    }
    setPasso((p) => Math.min(p + 1, PASSOS.length - 1));
  }

  function submeter(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (passo < PASSOS.length - 1) {
      avancar();
      return;
    }
    const texto = mensagem(valores);
    window.open(
      `https://wa.me/${EMPRESA.whatsapp}?text=${encodeURIComponent(texto)}`,
      "_blank",
      "noopener,noreferrer",
    );
    setEnviado(texto);
  }

  if (enviado) {
    return (
      <div>
        <p className="credito">Pedido pronto</p>
        <p className="h3 mt-[var(--s-xs)]">
          Abrimos o WhatsApp com o teu pedido escrito.
        </p>
        <p className="corpo mt-[var(--s-xs)]">
          Só falta carregar em enviar na conversa. Se ela não abriu, o browser
          terá bloqueado a janela: usa o botão aqui em baixo.
        </p>

        <pre className="pedido-resumo">{enviado}</pre>

        <div className="mt-[var(--s-sm)] flex flex-wrap gap-[var(--s-sm)]">
          <a
            className="btn"
            href={`https://wa.me/${EMPRESA.whatsapp}?text=${encodeURIComponent(enviado)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir a conversa
          </a>
          <button
            type="button"
            className="btn btn--contorno"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(enviado);
                setCopiado(true);
              } catch {
                setCopiado(false);
              }
            }}
          >
            {copiado ? "Mensagem copiada" : "Copiar mensagem"}
          </button>
          <button
            type="button"
            className="btn-quiet"
            onClick={() => {
              setEnviado(null);
              setValores(VAZIO);
              setPasso(0);
              setCopiado(false);
            }}
          >
            Fazer outro pedido
          </button>
        </div>
      </div>
    );
  }

  const ultimo = passo === PASSOS.length - 1;

  return (
    <form onSubmit={submeter} noValidate>
      {/* ⚠️ O FORMULARIO PRECISA DE DIZER O QUE E antes de perguntar o
          servico: comecava logo em "Serviço" e "Distrito" e nao se percebia o
          que estava a ser pedido. O titulo saiu quando o formulario subiu para
          debaixo do <h1> "Pede a tua proposta gratuita": eram duas frases
          quase iguais, uma por baixo da outra. */}
      <p className="credito mb-[var(--s-sm)]">Em três passos</p>

      {/* a barra: os discos dizem onde se esta, e o traco entre eles enche */}
      <ol
        className="passos-form"
        style={
          { "--progresso": passo / (PASSOS.length - 1) } as React.CSSProperties
        }
      >
        {PASSOS.map((p, i) => (
          <li
            key={p.rotulo}
            className="passos-form__item"
            data-estado={i < passo ? "feito" : i === passo ? "actual" : "falta"}
            aria-current={i === passo ? "step" : undefined}
          >
            <span className="passos-form__disco">{i + 1}</span>
            <span className="passos-form__rotulo">{p.rotulo}</span>
          </li>
        ))}
      </ol>

      <div className="passos-form__ecra" key={passo}>
        {passo === 0 ? (
          <>
            <Campo
              rotulo="Serviço"
              erro={erros.tipo}
              id="f-tipo"
              guardar={(el) => (refs.current.tipo = el)}
            >
              {(props) => (
                <select
                  {...props}
                  className="field"
                  value={valores.tipo}
                  onChange={(e) => escrever("tipo")(e.target.value)}
                >
                  <option value="" disabled>
                    Escolhe o serviço
                  </option>
                  {CONTACTO.tipos.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
            </Campo>

            <Campo
              rotulo="Distrito"
              erro={erros.distrito}
              id="f-distrito"
              guardar={(el) => (refs.current.distrito = el)}
            >
              {(props) => (
                <select
                  {...props}
                  className="field"
                  value={valores.distrito}
                  onChange={(e) => escrever("distrito")(e.target.value)}
                >
                  <option value="" disabled>
                    Escolhe o distrito
                  </option>
                  {CONTACTO.distritos.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </Campo>
          </>
        ) : null}

        {passo === 1 ? (
          <>
            <Campo
              rotulo="Nome"
              erro={erros.nome}
              id="f-nome"
              guardar={(el) => (refs.current.nome = el)}
            >
              {(props) => (
                <input
                  {...props}
                  className="field"
                  type="text"
                  autoComplete="name"
                  value={valores.nome}
                  onChange={(e) => escrever("nome")(e.target.value)}
                />
              )}
            </Campo>

            <Campo
              rotulo="Telefone"
              erro={erros.telefone}
              id="f-telefone"
              guardar={(el) => (refs.current.telefone = el)}
            >
              {(props) => (
                <input
                  {...props}
                  className="field"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={valores.telefone}
                  onChange={(e) => escrever("telefone")(e.target.value)}
                />
              )}
            </Campo>

            <Campo
              rotulo="Email"
              opcional
              erro={erros.email}
              id="f-email"
              guardar={(el) => (refs.current.email = el)}
            >
              {(props) => (
                <input
                  {...props}
                  className="field"
                  type="email"
                  autoComplete="email"
                  value={valores.email}
                  onChange={(e) => escrever("email")(e.target.value)}
                />
              )}
            </Campo>
          </>
        ) : null}

        {passo === 2 ? (
          <>
            <Campo
              rotulo="Alguma coisa que devamos saber"
              opcional
              id="f-nota"
              guardar={(el) => (refs.current.nota = el)}
            >
              {(props) => (
                <textarea
                  {...props}
                  className="field"
                  rows={4}
                  placeholder="Consumo mensal, tipo de telhado, se já tens orçamentos"
                  value={valores.nota}
                  onChange={(e) => escrever("nota")(e.target.value)}
                  style={{ minHeight: "6.5rem", resize: "vertical" }}
                />
              )}
            </Campo>

            <div>
              <p className="label">O que vamos enviar</p>
              <pre className="pedido-resumo">{mensagem(valores)}</pre>
            </div>
          </>
        ) : null}
      </div>

      <div className="mt-[var(--s-md)] flex flex-wrap items-center gap-[var(--s-sm)]">
        {passo > 0 ? (
          <button
            type="button"
            className="btn btn--contorno"
            onClick={() => setPasso((p) => p - 1)}
          >
            Voltar
          </button>
        ) : null}

        <button type="submit" className="btn">
          {ultimo ? "Enviar por WhatsApp" : "Seguinte"}
        </button>
      </div>

      <p className="meta mt-[var(--s-sm)]">
        Nada fica guardado neste site. Preferes email? Escreve para{" "}
        <a href={`mailto:${EMPRESA.email}`} style={{ textDecoration: "underline" }}>
          {EMPRESA.email}
        </a>
        .
      </p>
    </form>
  );
}

/** O molde de um campo: rotulo, controlo, e a linha de erro por baixo. */
function Campo({
  rotulo,
  id,
  erro,
  opcional,
  guardar,
  children,
}: {
  rotulo: string;
  id: string;
  erro?: string;
  opcional?: boolean;
  guardar: (el: HTMLElement | null) => void;
  children: (props: {
    id: string;
    ref: (el: HTMLElement | null) => void;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => React.ReactNode;
}) {
  return (
    <div className="grid gap-[var(--s-xs)]">
      <label className="label" htmlFor={id}>
        {rotulo}
        {opcional ? <span className="meta"> (opcional)</span> : null}
      </label>

      {children({
        id,
        ref: guardar,
        "aria-invalid": erro ? true : undefined,
        "aria-describedby": erro ? `${id}-erro` : undefined,
      })}

      {erro ? (
        <p className="meta" id={`${id}-erro`} role="alert" style={{ color: "#b3261e" }}>
          {erro}
        </p>
      ) : null}
    </div>
  );
}

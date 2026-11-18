#include <Arduino.h>
#include <avr/interrupt.h>
#include <util/atomic.h>
#include <string.h>

/*
  SERVO EM TESTE
  Permitidos:
  D36 = Servo 1
  D37 = Servo 2
  D38 = Servo 3
  D39 = Servo 4

  Altere apenas esta linha para escolher o servo:
*/
const int SERVO_PIN = 39;

static_assert(
  SERVO_PIN == 36 ||
  SERVO_PIN == 37 ||
  SERVO_PIN == 38 ||
  SERVO_PIN == 39,
  "Use D36, D37, D38 ou D39"
);

// LIMITES

// Faixa permitida para teste.
const int MIN_ANGLE = 10;
const int MAX_ANGLE = 80;

// Intervalo mínimo entre comandos.
const unsigned long MIN_STEP_MS = 300;

/*
  Timeout:
  após 5 segundos sem novo comando, para os pulsos.
*/
const unsigned long TIMEOUT_MS = 5000;

/*
  Escala nominal do servo:
  0 graus   -> 1000 us
  90 graus  -> 1500 us
  180 graus -> 2000 us
*/
const int PULSE_MIN_US = 1000;
const int PULSE_MAX_US = 2000;

static_assert(
  MIN_ANGLE >= 0 &&
  MAX_ANGLE <= 180 &&
  MIN_ANGLE < MAX_ANGLE,
  "Faixa de angulo invalida"
);

static_assert(
  PULSE_MIN_US >= 1000 &&
  PULSE_MAX_US <= 2000 &&
  PULSE_MIN_US < PULSE_MAX_US,
  "Faixa de pulsos invalida"
);

// ESTADO

int lastAngle = -1;

bool synchronized = false;
bool outputActive = false;

volatile uint16_t pulseTicks = 0;
volatile bool pulseHigh = false;

unsigned long commandAt = 0;

// Buffer Serial.
char commandBuffer[32];
uint8_t commandLength = 0;
bool discardLine = false;


// LEITURA DE NUMERO

bool readValue(const char* text, int &value) {

  if (!*text)
    return false;

  value = 0;

  for (; *text; ++text) {

    if (*text < '0' || *text > '9')
      return false;

    value = value * 10 + (*text - '0');

    if (value > 180)
      return false;
  }

  return true;
}


/*
  TIMER5

  Gera pulsos de servo sem usar a biblioteca Servo.

  Quadro aproximado:
  20 ms = 50 Hz

  Timer5:
  Arduino Mega 2560

*/

ISR(TIMER5_COMPA_vect) {

  if (pulseHigh) {

    // Terminou o pulso HIGH.
    digitalWrite(SERVO_PIN, LOW);

    // Tempo restante do quadro de 20 ms.
    OCR5A = 40000 - pulseTicks - 1;

  } else {

    // Começa novo pulso.
    digitalWrite(SERVO_PIN, HIGH);

    OCR5A = pulseTicks - 1;
  }

  pulseHigh = !pulseHigh;
}


// PARAR PULSOS

void stopOutput() {

  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {

    // Desabilita interrupção.
    TIMSK5 &= ~_BV(OCIE5A);

    // Para Timer5.
    TCCR5B = 0;

    // Mantém pino LOW.
    digitalWrite(SERVO_PIN, LOW);

    pulseHigh = false;
    pulseTicks = 0;
  }

  outputActive = false;
}


// APLICAR ANGULO

void applyAngle(int angle) {

  /*
    Converte ângulo em largura de pulso.

    0°   -> 1000 us
    90°  -> 1500 us
    180° -> 2000 us
  */

  const uint16_t ticks =
    2 * (
      PULSE_MIN_US +
      (long)(PULSE_MAX_US - PULSE_MIN_US) * angle / 180
    );

  ATOMIC_BLOCK(ATOMIC_RESTORESTATE) {

    pulseTicks = ticks;

    /*
      Se o Timer ainda não estava rodando,
      configura e inicia.
    */
    if (!outputActive) {

      pulseHigh = false;

      TCCR5A = 0;
      TCCR5B = 0;

      TCNT5 = 0;

      // Pequeno primeiro intervalo antes do primeiro pulso.
      OCR5A = 99;

      // Limpa flag.
      TIFR5 = _BV(OCF5A);

      // Habilita interrupção.
      TIMSK5 |= _BV(OCIE5A);

      /*
        CTC + prescaler 8.
        16 MHz / 8 = 2 MHz
        0,5 us por tick.
      */
      TCCR5B =
        _BV(WGM52) |
        _BV(CS51);
    }
  }

  outputActive = true;

  lastAngle = angle;

  commandAt = millis();
}


// STATUS

void printStatus() {

  Serial.println(
    F("Servos permitidos: D36, D37, D38, D39")
  );

  Serial.print(F("Servo atual: D"));
  Serial.print(SERVO_PIN);

  Serial.print(F(" | faixa: "));
  Serial.print(MIN_ANGLE);

  Serial.print(F(" a "));
  Serial.print(MAX_ANGLE);

  Serial.print(F(" graus"));

  if (synchronized) {

    Serial.print(F(" | SINCRONIZADO"));

    Serial.print(F(" | referencia: "));
    Serial.print(lastAngle);
    Serial.print(F(" graus"));

  } else {

    Serial.print(F(" | NAO SINCRONIZADO"));

    Serial.print(F(" | referencia desconhecida"));
  }

  if (outputActive) {

    Serial.println(F(" | pulsos ativos"));

  } else {

    Serial.println(F(" | pulsos parados"));
  }
}


// TIMEOUT

void checkTimeout() {

  if (
    outputActive &&
    (unsigned long)(millis() - commandAt) >= TIMEOUT_MS
  ) {

    stopOutput();

    Serial.println(F("TIMEOUT: pulsos cessados"));

    printStatus();
  }
}


// COMANDOS SERIAL

void handleCommand(char* command) {

  /*
    ----------------------------------------------------------
    STATUS
    ----------------------------------------------------------
  */

  if (!strcmp(command, "STATUS")) {

    printStatus();

    return;
  }


  /*
    ----------------------------------------------------------
    STOP
    ----------------------------------------------------------
  */

  if (!strcmp(command, "STOP")) {

    stopOutput();

    Serial.println(F("Pulsos parados"));

    printStatus();

    return;
  }


  int angle;


  /*
    ----------------------------------------------------------
    SYNC
    ----------------------------------------------------------

    Exemplo:
    SYNC 45

    NÃO move o servo.
    Apenas informa ao programa a posição atual estimada.

  */

  if (!strncmp(command, "SYNC ", 5)) {

    stopOutput();

    if (
      !readValue(command + 5, angle) ||
      angle < MIN_ANGLE ||
      angle > MAX_ANGLE
    ) {

      Serial.println(
        F("ERRO: SYNC deve estar entre 10 e 80 graus")
      );

      return;
    }

    lastAngle = angle;

    synchronized = true;

    commandAt = millis();

    Serial.print(
      F("OK: referencia sincronizada em ")
    );

    Serial.print(angle);

    Serial.println(
      F(" graus; nenhum pulso enviado")
    );

    return;
  }


  /*
    ----------------------------------------------------------
    ANGLE sem SYNC
    ----------------------------------------------------------
  */

  if (
    !strncmp(command, "ANGLE ", 6) &&
    !synchronized
  ) {

    stopOutput();

    Serial.println(
      F("ERRO: use SYNC <angulo> antes de ANGLE")
    );

    return;
  }


  /*
    ----------------------------------------------------------
    ANGLE
    ----------------------------------------------------------

    Aceita QUALQUER salto entre 10 e 80 graus.

    Exemplos:

    ANGLE 10
    ANGLE 45
    ANGLE 80

    Nao existe mais limite de 5 graus.

  */

  if (
    strncmp(command, "ANGLE ", 6) ||
    !readValue(command + 6, angle) ||
    angle < MIN_ANGLE ||
    angle > MAX_ANGLE
  ) {

    stopOutput();

    Serial.println(
      F("ERRO: use ANGLE com valor entre 10 e 80 graus")
    );

    printStatus();

    return;
  }


  /*
    ----------------------------------------------------------
    INTERVALO MÍNIMO
    ----------------------------------------------------------
  */

  if (
    lastAngle >= 0 &&
    (unsigned long)(millis() - commandAt) < MIN_STEP_MS
  ) {

    Serial.println(
      F("Aguarde 300 ms entre comandos")
    );

    return;
  }


  /*
    ----------------------------------------------------------
    APLICA ANGULO
    ----------------------------------------------------------
  */

  if (!outputActive) {

    Serial.println(
      F("ATENCAO: sem sensor de posicao; servo ira para o angulo solicitado.")
    );
  }

  /*
    Reaplica o mesmo comando varias vezes apenas para diagnostico.
    IMPORTANTE: o Timer5 ja gera pulsos continuamente a 50 Hz;
    este loop apenas reafirma o mesmo angulo varias vezes.
  */
  const int COMMAND_REPEATS = 10;
  const unsigned long COMMAND_REPEAT_MS = 100;

  for (int i = 0; i < COMMAND_REPEATS; ++i) {

    applyAngle(angle);

    Serial.print(F("Reenvio "));
    Serial.print(i + 1);
    Serial.print(F("/"));
    Serial.print(COMMAND_REPEATS);
    Serial.print(F(": ANGLE "));
    Serial.print(angle);
    Serial.println(F(" graus"));

    delay(COMMAND_REPEAT_MS);
  }

  Serial.print(F("ANGLE aplicado e reafirmado "));
  Serial.print(COMMAND_REPEATS);
  Serial.print(F(" vezes: "));
  Serial.print(angle);
  Serial.println(F(" graus"));

  printStatus();
}


// SETUP

void setup() {

  // Garante LOW antes de configurar como saída.
  digitalWrite(SERVO_PIN, LOW);

  pinMode(SERVO_PIN, OUTPUT);

  stopOutput();

  lastAngle = -1;

  synchronized = false;

  commandAt = 0;

  Serial.begin(115200);


  Serial.println();

  Serial.println(
    F("============================================")
  );

  Serial.println(
    F("DIAGNOSTICO DE SERVO - PLANTA 1")
  );

  Serial.println(
    F("============================================")
  );

  Serial.print(F("Servo selecionado: D"));
  Serial.println(SERVO_PIN);

  Serial.println(
    F("Permitidos: D36, D37, D38, D39")
  );

  Serial.println(
    F("Faixa: 10 a 80 graus")
  );

  Serial.println(
    F("Timeout: 5 segundos")
  );

  Serial.println(
    F("Nao existe limite de salto de 5 graus.")
  );

  Serial.println();

  Serial.println(
    F("Comandos:")
  );

  Serial.println(
    F("SYNC <angulo>")
  );

  Serial.println(
    F("ANGLE <angulo>")
  );

  Serial.println(
    F("STOP")
  );

  Serial.println(
    F("STATUS")
  );

  Serial.println();

  Serial.println(
    F("Exemplo:")
  );

  Serial.println(
    F("SYNC 45")
  );

  Serial.println(
    F("ANGLE 60")
  );

  Serial.println(
    F("ANGLE 20")
  );

  Serial.println(
    F("STOP")
  );

  Serial.println();

  Serial.println(
    F("SYNC apenas informa a referencia e NAO movimenta o servo.")
  );

  Serial.println(
    F("STOP cessa pulsos; nao garante posicao mecanica.")
  );

  Serial.println(
    F("Sem movimento automatico no boot.")
  );

  Serial.println();

  printStatus();
}


// LOOP

void loop() {

  checkTimeout();


  while (Serial.available() > 0) {

    checkTimeout();

    const char c = Serial.read();


    /*
      --------------------------------------------------------
      FIM DA LINHA
      --------------------------------------------------------
    */

    if (c == '\r' || c == '\n') {

      if (!discardLine && commandLength) {

        commandBuffer[commandLength] = '\0';

        handleCommand(commandBuffer);
      }

      commandLength = 0;

      discardLine = false;
    }


    /*
      --------------------------------------------------------
      RECEBE CARACTER
      --------------------------------------------------------
    */

    else if (!discardLine) {

      if (
        commandLength <
        sizeof(commandBuffer) - 1
      ) {

        commandBuffer[commandLength++] = c;

      } else {

        // Linha grande demais.
        discardLine = true;

        stopOutput();

        Serial.println(
          F("ERRO: comando muito longo; pulsos cessados")
        );

        printStatus();
      }
    }
  }
}
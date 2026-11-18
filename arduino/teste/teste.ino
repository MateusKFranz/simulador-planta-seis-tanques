void setup() {

  pinMode(7, OUTPUT);
  pinMode(8, OUTPUT);

}

void loop() {
  // Liga as 3 bombas em 150/255


  analogWrite(7, 150);
  analogWrite(8, 0);



  delay(3000);

  // Para todas

  analogWrite(7, 0);
  analogWrite(8, 0);


  delay(3000);
}
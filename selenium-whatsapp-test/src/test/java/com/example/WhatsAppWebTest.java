package com.example;

import org.openqa.selenium.WebDriver;
import org.openqa.selenium.chrome.ChromeDriver;
import org.testng.annotations.AfterClass;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.Test;

public class WhatsAppWebTest {
    private WebDriver driver;

    @BeforeClass
    public void setUp() {
        // Make sure chromedriver is on your PATH or set webdriver.chrome.driver system property.
        driver = new ChromeDriver();
    }

    @Test
    public void openWhatsAppWeb() {
        driver.get("https://web.whatsapp.com");
        String title = driver.getTitle();
        System.out.println("Page title: " + title);
    }

    @AfterClass
    public void tearDown() {
        if (driver != null) {
            driver.quit();
        }
    }
}

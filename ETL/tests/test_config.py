import unittest

from sqlalchemy import create_engine

from app.config import Settings


class DatabaseUrlTests(unittest.TestCase):
    def test_bare_postgres_urls_use_installed_driver(self) -> None:
        suffix = "user:p%40ss@localhost:5432/hackathons?sslmode=require"
        for scheme in ("postgresql", "postgres"):
            with self.subTest(scheme=scheme):
                settings = Settings(
                    _env_file=None,
                    DATABASE_URL=f"{scheme}://{suffix}",
                    MONGODB_CONNECTION_STRING="mongodb://localhost:27017",
                )
                self.assertEqual(settings.database_url, f"postgresql+psycopg://{suffix}")
                engine = create_engine(settings.database_url)
                try:
                    self.assertEqual(engine.dialect.driver, "psycopg")
                    self.assertEqual(engine.url.password, "p@ss")
                    self.assertEqual(engine.url.query["sslmode"], "require")
                finally:
                    engine.dispose()

    def test_explicit_driver_is_preserved(self) -> None:
        for driver in ("psycopg", "psycopg2", "asyncpg"):
            with self.subTest(driver=driver):
                url = f"postgresql+{driver}://user:password@localhost/hackathons"
                settings = Settings(
                    _env_file=None,
                    DATABASE_URL=url,
                    MONGODB_CONNECTION_STRING="mongodb://localhost:27017",
                )
                self.assertEqual(settings.database_url, url)


if __name__ == "__main__":
    unittest.main()
